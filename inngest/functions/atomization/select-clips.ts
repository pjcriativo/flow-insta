import { inngest } from "../../client";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { getOpenAI, AI_MODEL } from "@/lib/ai";
import { loadJob, setJobStatus, failJob, isTerminal } from "@/lib/atomization/pipeline";
import { ClipSelectionSchema, parseAiJson } from "@/lib/atomization/schemas";
import { clipSelectionPrompt } from "@/lib/atomization/prompts";

// 2ª etapa: IA seleciona os clips. Insere idempotente por (job_id, clip_index).
export const atomizationSelectClips = inngest.createFunction(
  { id: "atomization-select-clips", name: "Atomization: Select Clips", retries: 2, triggers: [{ event: "atomization/transcript.ready" }] },
  async ({ event, step, logger }) => {
    const { jobId } = event.data as { jobId: string };

    try {
      const job = await step.run("load-job", () => loadJob(jobId));
      if (!job) return { skipped: true, reason: "job_not_found" };
      if (isTerminal(job.status)) return { skipped: true, reason: job.status };

      await step.run("status-selecting", () => setJobStatus(jobId, "selecting"));

      const clips = await step.run("select", async () => {
        const admin = getSupabaseAdminClient();

        // Idempotência: se já há clips, não re-seleciona.
        const { count: existingCount } = await admin
          .from("atomization_clips")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId);
        if ((existingCount ?? 0) > 0) {
          return { count: existingCount ?? 0, reused: true };
        }

        const { data: transcript } = await admin
          .from("atomization_transcripts")
          .select("full_text, segments")
          .eq("job_id", jobId)
          .maybeSingle();

        const target = (job.settings as { clip_count?: number })?.clip_count ?? 5;
        const completion = await getOpenAI().chat.completions.create({
          model: AI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: clipSelectionPrompt(target) },
            {
              role: "user",
              content: `Vídeo: ${job.title ?? ""} (${job.duration_seconds ?? "?"}s).
Transcript: ${transcript?.full_text ?? ""}
Segmentos: ${JSON.stringify(transcript?.segments ?? [])}`,
            },
          ],
        });

        const raw = completion.choices[0]?.message?.content;
        const parsed = parseAiJson(ClipSelectionSchema, raw);
        if (!parsed.ok) {
          throw new Error(`Seleção de clips inválida: ${parsed.error}`);
        }

        // Insere clips com idempotency key. organization_id SEMPRE do job.
        const rows = parsed.data.clips.map((c, i) => ({
          job_id: jobId,
          organization_id: job.organization_id,
          clip_index: i,
          start_seconds: c.start_seconds,
          end_seconds: c.end_seconds,
          hook_text: c.hook_text,
          rationale: c.rationale,
          virality_score: c.virality_score,
          status: "selected" as const,
          render_idempotency_key: `${jobId}:${i}`,
        }));
        const { error } = await admin
          .from("atomization_clips")
          .upsert(rows, { onConflict: "job_id,clip_index", ignoreDuplicates: true });
        if (error) throw new Error(`Falha ao salvar clips: ${error.message}`);

        await admin
          .from("atomization_jobs")
          .update({ clip_count: rows.length })
          .eq("id", jobId);

        return { count: rows.length, reused: false };
      });

      // Dispara o render (a função render orquestra o fan-out por clip).
      await step.sendEvent("to-render", {
        name: "atomization/clips.selected",
        data: { jobId, organizationId: job.organization_id },
      });

      logger.info("Clips selected", { jobId, clips });
      return { ok: true };
    } catch (e) {
      await failJob(jobId, e instanceof Error ? e.message : "Falha na seleção de clips");
      return { ok: false };
    }
  }
);
