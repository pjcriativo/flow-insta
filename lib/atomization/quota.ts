import type { SupabaseClient } from "@supabase/supabase-js";
import { enforceLimit, getOrgPlan, PlanLimitError } from "@/lib/plan-limits";

// Teto de jobs de atomização por mês por plano (a IA já é gated pelo plano).
const MONTHLY_JOB_LIMIT: Record<string, number> = {
  free: 0, // free não tem atomização (não tem IA)
  pro: 30,
  business: -1, // ilimitado
};

/**
 * Garante que a org pode criar um job de atomização:
 *  - plano precisa ter IA (enforceLimit "ai") — lança PlanLimitError se não.
 *  - respeita o teto mensal de jobs do plano.
 * Lança PlanLimitError (mapeado para 403 na rota) ao exceder.
 */
export async function enforceAtomizationQuota(
  supabase: SupabaseClient,
  orgId: string
): Promise<void> {
  // 1. Atomização exige IA (Pro/Business).
  await enforceLimit(supabase, orgId, "ai");

  // 2. Teto mensal de jobs.
  const plan = await getOrgPlan(supabase, orgId);
  const limit = MONTHLY_JOB_LIMIT[plan.id] ?? 0;
  if (limit === -1) return; // ilimitado

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("atomization_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("created_at", start.toISOString());

  if ((count ?? 0) >= limit) {
    throw new PlanLimitError(
      `Você atingiu o limite de ${limit} atomizações/mês do plano ${plan.name}. Faça upgrade para continuar.`
    );
  }
}
