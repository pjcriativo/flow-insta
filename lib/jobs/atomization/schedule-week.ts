import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { loadJob, setJobStatus } from "@/lib/atomization/pipeline";

/**
 * 5ª etapa: distribui os posts no calendário SE auto_schedule estiver ligado.
 * Caso contrário, deixa tudo como draft. Marca o job como 'completed'.
 * Runner puro: chamado pelo tick quando status === 'scheduling'.
 */
export async function runScheduleWeek(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("job_not_found");

  const autoSchedule = (job.settings as { auto_schedule?: boolean })?.auto_schedule === true;
  const admin = getSupabaseAdminClient();

  // Posts draft gerados por este job (via assets reel_caption -> post_id).
  const { data: assets } = await admin
    .from("atomization_assets")
    .select("post_id, atomization_clips!inner(job_id)")
    .eq("organization_id", job.organization_id)
    .eq("asset_type", "reel_caption")
    .eq("atomization_clips.job_id", jobId);

  const postIds = (assets ?? [])
    .map((a) => a.post_id)
    .filter((id): id is string => !!id);

  // INVARIANTE: sem auto_schedule, NADA é agendado/publicado. Fica draft.
  if (autoSchedule && postIds.length > 0) {
    // Distribui um post por dia, a partir de amanhã às ~10h BRT, move para 'queue'.
    let day = 1;
    for (const postId of postIds) {
      const when = new Date();
      when.setUTCDate(when.getUTCDate() + day);
      when.setUTCHours(13, 0, 0, 0); // 10h BRT aprox.
      await admin
        .from("scheduled_posts")
        .update({ scheduled_at: when.toISOString(), status: "queue" })
        .eq("id", postId)
        .eq("org_id", job.organization_id)
        .eq("status", "draft"); // só move drafts (idempotente em retry)
      day++;
    }
  }

  await setJobStatus(jobId, "completed");
}
