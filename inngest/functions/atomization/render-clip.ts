import { inngest } from "../../client";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { loadJob, setJobStatus, failJob, isTerminal } from "@/lib/atomization/pipeline";
import { getVideoRenderer } from "@/lib/atomization/renderer";

// 3a: orquestra o fan-out — um evento de render por clip.
export const atomizationRenderOrchestrate = inngest.createFunction(
  { id: "atomization-render-orchestrate", name: "Atomization: Render (orchestrate)", retries: 2, triggers: [{ event: "atomization/clips.selected" }] },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };
    try {
      const job = await step.run("load-job", () => loadJob(jobId));
      if (!job) return { skipped: true, reason: "job_not_found" };
      if (isTerminal(job.status)) return { skipped: true, reason: job.status };

      await step.run("status-rendering", () => setJobStatus(jobId, "rendering"));

      const clips = await step.run("load-clips", async () => {
        const admin = getSupabaseAdminClient();
        const { data } = await admin
          .from("atomization_clips")
          .select("id, clip_index")
          .eq("job_id", jobId)
          .order("clip_index", { ascending: true });
        return data ?? [];
      });

      if (clips.length === 0) {
        await failJob(jobId, "Nenhum clip para renderizar");
        return { ok: false };
      }

      // Fan-out: um evento por clip.
      await step.sendEvent(
        "fan-out-render",
        clips.map((c) => ({
          name: "atomization/clip.render.requested",
          data: { jobId, organizationId: job.organization_id, clipId: c.id, clipIndex: c.clip_index },
        }))
      );

      return { ok: true, dispatched: clips.length };
    } catch (e) {
      await failJob(jobId, e instanceof Error ? e.message : "Falha ao orquestrar render");
      return { ok: false };
    }
  }
);

// 3b: renderiza UM clip. Idempotente por render_idempotency_key.
export const atomizationRenderClip = inngest.createFunction(
  {
    id: "atomization-render-clip",
    name: "Atomization: Render Clip",
    retries: 3,
    // Limita concorrência por job para não sobrecarregar o worker externo.
    concurrency: { limit: 3, key: "event.data.jobId" },
    triggers: [{ event: "atomization/clip.render.requested" }],
  },
  async ({ event, step }) => {
    const { jobId, clipId } = event.data as { jobId: string; clipId: string };

    try {
      const result = await step.run("render", async () => {
        const admin = getSupabaseAdminClient();
        const { data: clip } = await admin
          .from("atomization_clips")
          .select("id, job_id, organization_id, clip_index, start_seconds, end_seconds, status, video_asset_path, render_idempotency_key")
          .eq("id", clipId)
          .maybeSingle();
        if (!clip) return { skipped: "clip_not_found" };

        // IDEMPOTÊNCIA: se já renderizou, não re-renderiza.
        if (clip.status === "rendered" && clip.video_asset_path) {
          return { skipped: "already_rendered" };
        }

        const { data: job } = await admin
          .from("atomization_jobs")
          .select("source_url")
          .eq("id", clip.job_id)
          .maybeSingle();

        await admin.from("atomization_clips").update({ status: "rendering" }).eq("id", clip.id);

        const renderer = getVideoRenderer();
        const out = await renderer.render({
          jobId: clip.job_id,
          clipIndex: clip.clip_index,
          organizationId: clip.organization_id,
          sourceUrl: job?.source_url ?? "",
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

        return { rendered: true };
      });

      // Quando o último clip termina, dispara generate-assets (idempotente lá).
      await step.run("maybe-advance", async () => {
        const admin = getSupabaseAdminClient();
        const { data: clips } = await admin
          .from("atomization_clips")
          .select("status")
          .eq("job_id", jobId);
        const all = clips ?? [];
        const allDone = all.length > 0 && all.every((c) => c.status === "rendered" || c.status === "render_failed" || c.status === "discarded");
        if (allDone) {
          const { data: job } = await admin
            .from("atomization_jobs")
            .select("organization_id, status")
            .eq("id", jobId)
            .maybeSingle();
          if (job && !["failed", "canceled", "completed"].includes(job.status)) {
            await inngest.send({
              name: "atomization/clips.rendered",
              data: { jobId, organizationId: job.organization_id },
            });
          }
        }
      });

      return { ok: true, result };
    } catch (e) {
      // Falha num clip marca o clip, não o job inteiro (outros podem seguir).
      const admin = getSupabaseAdminClient();
      await admin.from("atomization_clips").update({ status: "render_failed" }).eq("id", clipId);
      return { ok: false, error: e instanceof Error ? e.message : "render_error" };
    }
  }
);
