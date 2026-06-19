import { getSupabaseAdminClient } from "@/lib/supabase-server";
import type { JobStatus } from "@/types/atomization";

/**
 * Helpers compartilhados pelas funções Inngest do pipeline de atomização.
 * Tudo via admin client (service_role). organization_id SEMPRE derivado do job.
 */

export async function loadJob(jobId: string) {
  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from("atomization_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  return data;
}

export async function setJobStatus(jobId: string, status: JobStatus): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin.from("atomization_jobs").update({ status }).eq("id", jobId);
}

/**
 * Marca o job como failed com a mensagem. Use no catch de cada função para
 * nunca deixar lixo parcial sem marcação. Não relança.
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin
    .from("atomization_jobs")
    .update({ status: "failed", error: error.slice(0, 1000) })
    .eq("id", jobId);
}

/** Status terminal: não continuar o pipeline. */
export function isTerminal(status: JobStatus): boolean {
  return status === "failed" || status === "canceled" || status === "completed";
}
