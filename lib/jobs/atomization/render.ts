import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { loadJob, setJobStatus, failJob } from "@/lib/atomization/pipeline";
import { getVideoRenderer } from "@/lib/atomization/renderer";

// Quantos clips renderizar por chamada (equivale ao antigo concurrency.limit:3).
const RENDER_BATCH = 3;

/**
 * 3ª etapa: renderiza os clips pendentes (lote) e avalia a barreira.
 * Runner puro: chamado pelo tick quando status === 'rendering'.
 *
 * Os clips inseridos por select-clips (status 'selected') SÃO a fila de render.
 * Cada render é idempotente por render_idempotency_key / status já 'rendered'.
 * Falha de UM clip marca o clip como 'render_failed' (não derruba o job).
 *
 * Barreira: quando todos os clips ∈ {rendered, render_failed, discarded}:
 *   - se há ≥1 rendered -> avança para 'generating'
 *   - se nenhum rendered -> failJob
 * Senão, deixa em 'rendering' (o próximo tick continua).
 */
export async function runRenderStep(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("job_not_found");

  const admin = getSupabaseAdminClient();

  // Carrega o lote de clips ainda pendentes (selected ou rendering órfão).
  const { data: pending } = await admin
    .from("atomization_clips")
    .select(
      "id, job_id, organization_id, clip_index, start_seconds, end_seconds, status, video_asset_path, render_idempotency_key"
    )
    .eq("job_id", jobId)
    .in("status", ["selected", "rendering"])
    .order("clip_index", { ascending: true })
    .limit(RENDER_BATCH);

  for (const clip of pending ?? []) {
    // IDEMPOTÊNCIA: se já renderizou, pula.
    if (clip.status === "rendered" && clip.video_asset_path) continue;

    try {
      await admin.from("atomization_clips").update({ status: "rendering" }).eq("id", clip.id);

      const renderer = getVideoRenderer();
      const out = await renderer.render({
        jobId: clip.job_id,
        clipIndex: clip.clip_index,
        organizationId: clip.organization_id,
        sourceUrl: job.source_url ?? "",
        startSeconds: Number(clip.start_seconds),
        endSeconds: Number(clip.end_seconds),
        idempotencyKey: clip.render_idempotency_key ?? `${clip.job_id}:${clip.clip_index}`,
      });

      await admin
        .from("atomization_clips")
        .update({
          status: "rendered",
          video_asset_path: out.videoAssetPath,
          thumbnail_path: out.thumbnailPath,
        })
        .eq("id", clip.id);
    } catch (e) {
      // Falha de um clip marca só o clip; outros podem seguir.
      console.error("[render] clip falhou", clip.id, String(e));
      await admin.from("atomization_clips").update({ status: "render_failed" }).eq("id", clip.id);
    }
  }

  // Avalia a barreira: todos os clips em estado terminal de render?
  const { data: all } = await admin
    .from("atomization_clips")
    .select("status")
    .eq("job_id", jobId);

  const clips = all ?? [];
  if (clips.length === 0) {
    await failJob(jobId, "Nenhum clip para renderizar");
    return;
  }

  const allDone = clips.every(
    (c) => c.status === "rendered" || c.status === "render_failed" || c.status === "discarded"
  );
  if (!allDone) {
    // Ainda há clips pendentes — o próximo tick continua. Mantém 'rendering'.
    return;
  }

  const anyRendered = clips.some((c) => c.status === "rendered");
  if (!anyRendered) {
    await failJob(jobId, "Nenhum clip pôde ser renderizado");
    return;
  }

  await setJobStatus(jobId, "generating");
}
