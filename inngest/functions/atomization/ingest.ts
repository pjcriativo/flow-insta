import { inngest } from "../../client";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { loadJob, setJobStatus, failJob, isTerminal } from "@/lib/atomization/pipeline";

// 1ª etapa: metadados + transcript. Encadeia para select-clips.
export const atomizationIngest = inngest.createFunction(
  { id: "atomization-ingest", name: "Atomization: Ingest", retries: 2, triggers: [{ event: "atomization/job.created" }] },
  async ({ event, step, logger }) => {
    const { jobId } = event.data as { jobId: string };

    try {
      const job = await step.run("load-job", () => loadJob(jobId));
      if (!job) return { skipped: true, reason: "job_not_found" };
      if (isTerminal(job.status)) return { skipped: true, reason: job.status };

      await step.run("status-fetching", () => setJobStatus(jobId, "fetching"));

      // Transcript. No ambiente sem worker (mock), gera um transcript placeholder.
      // Com worker real: legenda nativa do YouTube -> fallback Whisper.
      const transcript = await step.run("transcribe", async () => {
        const admin = getSupabaseAdminClient();
        await setJobStatus(jobId, "transcribing");

        // Mock determinístico (idempotente): se já existe transcript, reusa.
        const { data: existing } = await admin
          .from("atomization_transcripts")
          .select("id")
          .eq("job_id", jobId)
          .maybeSingle();
        if (existing) return { reused: true };

        const fullText =
          `Transcrição (mock) do vídeo "${job.title ?? "sem título"}". ` +
          `Conteúdo de exemplo para o pipeline de atomização.`;
        const segments = [
          { start: 0, end: 20, text: "Introdução do vídeo." },
          { start: 20, end: 50, text: "Ponto principal com gancho forte." },
          { start: 50, end: 80, text: "Conclusão e chamada para ação." },
        ];

        await admin.from("atomization_transcripts").insert({
          job_id: jobId,
          organization_id: job.organization_id, // SEMPRE do job
          language: "pt",
          full_text: fullText,
          segments,
        });
        await admin
          .from("atomization_jobs")
          .update({ transcript_source: "native", language: "pt" })
          .eq("id", jobId);

        return { reused: false };
      });

      // Encadeia a seleção de clips.
      await step.sendEvent("to-select-clips", {
        name: "atomization/transcript.ready",
        data: { jobId, organizationId: job.organization_id },
      });

      logger.info("Ingest done", { jobId, transcript });
      return { ok: true };
    } catch (e) {
      await failJob(jobId, e instanceof Error ? e.message : "Falha no ingest");
      return { ok: false };
    }
  }
);
