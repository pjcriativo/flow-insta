import { getSupabaseAdminClient } from "@/lib/supabase-server";
import type { JobStatus } from "@/types/atomization";

// Lease padrão: tempo após o qual um job/post "preso" é reivindicado de novo.
export const DEFAULT_LEASE = "5 minutes";

export type ClaimedJob = {
  id: string;
  status: JobStatus;
  attempts: number;
};

/**
 * Reivindica até `limit` jobs de atomização elegíveis (não-terminais, fora de
 * backoff, lease livre/expirado). Atômico via RPC com FOR UPDATE SKIP LOCKED.
 */
export async function claimAtomizationJobs(limit: number, lease = DEFAULT_LEASE): Promise<ClaimedJob[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_atomization_jobs", {
    p_limit: limit,
    p_lease: lease,
  });
  if (error) {
    console.error("[claim] claim_atomization_jobs falhou", error.message);
    return [];
  }
  return (data ?? []).map((j: { id: string; status: JobStatus; attempts: number }) => ({
    id: j.id,
    status: j.status,
    attempts: j.attempts,
  }));
}

/**
 * Reivindica até `limit` posts vencidos (queue/scheduled<=now ou publishing
 * órfão), movendo-os para 'publishing'. Retorna os ids reivindicados.
 */
export async function claimDuePosts(limit: number, lease = DEFAULT_LEASE): Promise<string[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_due_posts", {
    p_limit: limit,
    p_lease: lease,
  });
  if (error) {
    console.error("[claim] claim_due_posts falhou", error.message);
    return [];
  }
  return (data ?? []).map((p: { id: string }) => p.id);
}

/**
 * Reivindica até `limit` projetos de conteúdo em 'generating' (fora de backoff,
 * lease livre/expirado), marcando o lease. Atômico via RPC com SKIP LOCKED.
 * Retorna os ids reivindicados.
 */
export async function claimDueContentProjects(
  limit: number,
  lease = DEFAULT_LEASE
): Promise<Array<{ id: string; attempts: number }>> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_due_content_projects", {
    p_limit: limit,
    p_lease: lease,
  });
  if (error) {
    console.error("[claim] claim_due_content_projects falhou", error.message);
    return [];
  }
  return (data ?? []).map((p: { id: string; attempts: number }) => ({
    id: p.id,
    attempts: p.attempts,
  }));
}
