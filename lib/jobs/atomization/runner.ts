import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { failJob, isTerminal } from "@/lib/atomization/pipeline";
import type { JobStatus } from "@/types/atomization";
import { runIngest } from "./ingest";
import { runSelectClips } from "./select-clips";
import { runRenderStep } from "./render";
import { runGenerateAssets } from "./generate-assets";
import { runScheduleWeek } from "./schedule-week";

// Tentativas por ETAPA antes de falhar o job (replica retries:2/3 do Inngest).
const MAX_ATTEMPTS = 3;

// Backoff exponencial simples (minutos), teto de 10 min.
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 10);
}

type Job = {
  id: string;
  status: JobStatus;
  attempts: number;
};

/**
 * Executa UMA etapa do pipeline de atomização para um job já reivindicado
 * (locked_at setado, attempts incrementado pelo claim).
 *
 * - Mapeia status -> runner. Cada runner avança o status ao terminar.
 * - Em SUCESSO: libera o lock e zera attempts/next_attempt_at (a próxima etapa
 *   tem seu próprio orçamento de tentativas).
 * - Em FALHA: se attempts < MAX, agenda retry com backoff (libera lock, mantém
 *   o status atual). Se attempts >= MAX, falha o job (failJob).
 *
 * Retorna o status resultante (ou 'unchanged' se já terminal / nada a fazer).
 */
export async function runAtomizationStep(job: Job): Promise<string> {
  const admin = getSupabaseAdminClient();

  // Job pode ter sido cancelado/finalizado entre o claim e agora.
  if (isTerminal(job.status)) {
    await releaseLock(job.id);
    return job.status;
  }

  try {
    switch (job.status) {
      case "queued":
      case "fetching":
      case "transcribing":
        await runIngest(job.id);
        break;
      case "selecting":
        await runSelectClips(job.id);
        break;
      case "rendering":
        await runRenderStep(job.id);
        break;
      case "generating":
        await runGenerateAssets(job.id);
        break;
      case "scheduling":
        await runScheduleWeek(job.id);
        break;
      default:
        // Status desconhecido/terminal: só libera.
        await releaseLock(job.id);
        return job.status;
    }

    // Sucesso da etapa: libera o lock e zera o contador para a próxima etapa.
    await admin
      .from("atomization_jobs")
      .update({ locked_at: null, attempts: 0, next_attempt_at: null })
      .eq("id", job.id);

    const { data } = await admin
      .from("atomization_jobs")
      .select("status")
      .eq("id", job.id)
      .maybeSingle();
    return data?.status ?? job.status;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha na etapa de atomização";
    // attempts já foi incrementado pelo claim; se estourou o teto, falha o job.
    if (job.attempts >= MAX_ATTEMPTS) {
      await failJob(job.id, message);
      await releaseLock(job.id);
      return "failed";
    }
    // Senão, agenda nova tentativa com backoff e libera o lock (mantém status).
    const next = new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString();
    await admin
      .from("atomization_jobs")
      .update({ locked_at: null, next_attempt_at: next, error: message.slice(0, 1000) })
      .eq("id", job.id);
    console.warn("[atomization] etapa falhou, retry agendado", {
      jobId: job.id,
      status: job.status,
      attempts: job.attempts,
      next,
      message,
    });
    return job.status;
  }
}

async function releaseLock(jobId: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin.from("atomization_jobs").update({ locked_at: null }).eq("id", jobId);
}
