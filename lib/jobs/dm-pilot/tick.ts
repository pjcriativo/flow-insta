import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { runDmPilotStep } from "./runner";
import type { EventRow } from "./types";

// ============================================================
// Tick do DM Pilot: reivindica eventos elegíveis via claim_due_interactions
// (FOR UPDATE SKIP LOCKED + lease) e executa UMA etapa de cada, repetindo
// enquanto houver orçamento de tempo — igual a runAtomizationTick.
// ============================================================

const EVENTS_PER_TICK = 10;
const DEFAULT_LEASE = "5 minutes";

async function claimDueInteractions(limit: number, lease = DEFAULT_LEASE): Promise<EventRow[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_due_interactions", {
    p_limit: limit,
    p_lease: lease,
  });
  if (error) {
    console.error("[dm-pilot/tick] claim_due_interactions falhou", error.message);
    return [];
  }
  return (data ?? []) as EventRow[];
}

export async function runDmPilotTick({
  limit = EVENTS_PER_TICK,
  budgetMs = 50_000,
  startedAt = Date.now(),
} = {}) {
  let stepsRun = 0;
  let advanced = 0;

  while (Date.now() - startedAt < budgetMs) {
    const events = await claimDueInteractions(limit);
    if (events.length === 0) break;

    for (const event of events) {
      if (Date.now() - startedAt >= budgetMs) break;
      const before = event.status;
      const after = await runDmPilotStep(event, Date.now());
      stepsRun++;
      if (after !== before) advanced++;
    }
  }

  return { stepsRun, advanced };
}
