import { getSupabaseAdminClient } from "@/lib/supabase-server";

/**
 * Registra uma ação administrativa no log de auditoria.
 * Falhas no log nunca devem quebrar a ação principal (best-effort).
 */
export async function logAudit(params: {
  actorId: string;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: params.actorId,
      actor_email: params.actorEmail ?? null,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      details: params.details ?? {},
    });
  } catch (e) {
    console.error("Failed to write audit log:", e);
  }
}
