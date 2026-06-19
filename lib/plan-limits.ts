import { getSupabaseAdminClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanLimits = {
  id: string;
  name: string;
  max_channels: number; // -1 = ilimitado
  max_posts: number; // por mês, -1 = ilimitado
  max_members: number; // -1 = ilimitado
  ai_enabled: boolean;
};

const UNLIMITED = -1;
export const isUnlimited = (n: number) => n === UNLIMITED;

/** Busca os limites do plano de uma organização. */
export async function getOrgPlan(
  supabase: SupabaseClient,
  orgId: string
): Promise<PlanLimits> {
  const { data: org } = await supabase
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .single();

  const planId = org?.plan ?? "free";
  const { data: plan } = await supabase
    .from("plans")
    .select("id, name, max_channels, max_posts, max_members, ai_enabled")
    .eq("id", planId)
    .single();

  // Fallback seguro (free) se o plano não for encontrado.
  return (
    plan ?? {
      id: "free", name: "Free", max_channels: 2, max_posts: 10, max_members: 1, ai_enabled: false,
    }
  );
}

/** Conta canais conectados da org. */
export async function countChannels(supabase: SupabaseClient, orgId: string) {
  const { count } = await supabase
    .from("user_channels")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("is_connected", true);
  return count ?? 0;
}

/** Conta posts criados no mês corrente. */
export async function countPostsThisMonth(supabase: SupabaseClient, orgId: string) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("created_at", start.toISOString());
  return count ?? 0;
}

/** Conta membros da org. */
export async function countMembers(supabase: SupabaseClient, orgId: string) {
  const { count } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  return count ?? 0;
}

export class PlanLimitError extends Error {
  constructor(public readonly limitMessage: string) {
    super("PLAN_LIMIT");
  }
}

/**
 * Garante que a org pode realizar a ação; lança PlanLimitError se exceder.
 * `addCount` é quantos itens serão adicionados (default 1).
 */
export async function enforceLimit(
  supabase: SupabaseClient,
  orgId: string,
  resource: "channels" | "posts" | "members" | "ai",
  addCount = 1
): Promise<void> {
  const plan = await getOrgPlan(supabase, orgId);

  if (resource === "ai") {
    if (!plan.ai_enabled) {
      throw new PlanLimitError(
        `A IA está disponível a partir do plano Pro. Faça upgrade para usar este recurso.`
      );
    }
    return;
  }

  const limit =
    resource === "channels" ? plan.max_channels :
    resource === "posts" ? plan.max_posts :
    plan.max_members;

  if (isUnlimited(limit)) return;

  const current =
    resource === "channels" ? await countChannels(supabase, orgId) :
    resource === "posts" ? await countPostsThisMonth(supabase, orgId) :
    await countMembers(supabase, orgId);

  if (current + addCount > limit) {
    const label =
      resource === "channels" ? `canais (${limit})` :
      resource === "posts" ? `posts por mês (${limit})` :
      `membros (${limit})`;
    throw new PlanLimitError(
      `Você atingiu o limite de ${label} do plano ${plan.name}. Faça upgrade para continuar.`
    );
  }
}

/** Resposta padrão de limite (para as rotas). */
export function planLimitResponse(error: unknown): { message: string } | null {
  if (error instanceof PlanLimitError) {
    return { message: error.limitMessage };
  }
  return null;
}

/** Util admin: muda o plano de uma org. */
export async function setOrgPlan(orgId: string, planId: string) {
  const admin = getSupabaseAdminClient();
  return admin.from("organizations").update({ plan: planId }).eq("id", orgId);
}
