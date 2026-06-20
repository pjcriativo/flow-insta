import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { loadJob, setJobStatus } from "@/lib/atomization/pipeline";

/**
 * 1ª etapa: metadados + transcript. Avança o job para 'selecting'.
 * Runner puro (sem Inngest): chamado pelo tick quando status === 'queued'.
 * Idempotente: reusa transcript existente.
 */
export async function runIngest(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) throw new Error("job_not_found");

  await setJobStatus(jobId, "fetching");

  const admin = getSupabaseAdminClient();
  await setJobStatus(jobId, "transcribing");

  // Mock determinístico (idempotente): se já existe transcript, reusa.
  const { data: existing } = await admin
    .from("atomization_transcripts")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!existing) {
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
  }

  // Avança para a seleção de clips.
  await setJobStatus(jobId, "selecting");
}
