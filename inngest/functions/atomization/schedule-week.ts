import { inngest } from "../../client";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { loadJob, setJobStatus, failJob, isTerminal } from "@/lib/atomization/pipeline";

// 5ª etapa: distribui os posts no calendário SE auto_schedule estiver ligado.
// Caso contrário, deixa tudo como draft. Marca o job como completed.
export const atomizationScheduleWeek = inngest.createFunction(
  { id: "atomization-schedule-week", name: "Atomization: Schedule Week", retries: 2, triggers: [{ event: "atomization/assets.generated" }] },
  async ({ event, step, logger }) => {
    const { jobId } = event.data as { jobId: string };

    try {
      const job = await step.run("load-job", () => loadJob(jobId));
      if (!job) return { skipped: true, reason: "job_not_found" };
      if (isTerminal(job.status)) return { skipped: true, reason: job.status };

      await step.run("status-scheduling", () => setJobStatus(jobId, "scheduling"));

      const autoSchedule = (job.settings as { auto_schedule?: boolean })?.auto_schedule === true;

      await step.run("schedule-or-keep-draft", async () => {
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
        if (!autoSchedule || postIds.length === 0) {
          logger.info("auto_schedule OFF — mantendo drafts", { jobId, drafts: postIds.length });
          return;
        }

        // Distribui um post por dia, a partir de amanhã às 10h, e move para 'queue'.
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
        logger.info("Posts agendados", { jobId, count: postIds.length });
      });

      await step.run("status-completed", () => setJobStatus(jobId, "completed"));
      return { ok: true };
    } catch (e) {
      await failJob(jobId, e instanceof Error ? e.message : "Falha ao agendar");
      return { ok: false };
    }
  }
);
