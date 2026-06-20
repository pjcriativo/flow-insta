import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { sendApprovalNotification } from "./approval-notify";

// ============================================================
// Handler do tick: envia notificações de aprovação enfileiradas.
// Reivindica approval_notifications via claim_approval_notifications (lease +
// SKIP LOCKED), envia (e-mail/WhatsApp) e marca 'sent' ou reagenda com backoff.
// Dois ticks nunca enviam a mesma notificação (lease). Invariante #8.
// ============================================================

const NOTIFY_LIMIT = 10;
const LEASE = "2 minutes";
const MAX_ATTEMPTS = 4;

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 30);
}

export async function runApprovalNotifyTick({ limit = NOTIFY_LIMIT } = {}) {
  const admin = getSupabaseAdminClient();

  const { data, error } = await admin.rpc("claim_approval_notifications", {
    p_limit: limit,
    p_lease: LEASE,
  });
  if (error) {
    console.error("[approval-notify-tick] claim falhou", error.message);
    return { claimed: 0, sent: 0, failed: 0 };
  }

  const rows = (data ?? []) as Array<{
    id: string;
    organization_id: string;
    collection_id: string;
    collection_item_id: string | null;
    decision: string | null;
    decision_id: string | null;
    attempts: number;
  }>;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await sendApprovalNotification({
        collection_id: row.collection_id,
        organization_id: row.organization_id,
        collection_item_id: row.collection_item_id ?? "",
        decision: row.decision ?? "",
        decision_id: row.decision_id,
      });

      // Considera enviado se algum canal entregou OU se não havia destinatário
      // configurável (no-op intencional — não adianta retry infinito).
      const emailSent = result.email?.sent === true;
      const emailNoConfig =
        result.email?.reason === "no_api_key" || result.email?.reason === "no_recipient";
      const delivered = emailSent || emailNoConfig;

      if (delivered) {
        await admin
          .from("approval_notifications")
          .update({ status: "sent", locked_at: null })
          .eq("id", row.id);
        sent++;
      } else {
        await reschedule(admin, row.id, row.attempts);
        failed++;
      }
    } catch (e) {
      console.error("[approval-notify-tick] envio erro", row.id, String(e));
      await reschedule(admin, row.id, row.attempts);
      failed++;
    }
  }

  return { claimed: rows.length, sent, failed };
}

async function reschedule(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  id: string,
  attempts: number
): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await admin
      .from("approval_notifications")
      .update({ status: "failed", locked_at: null })
      .eq("id", id);
    return;
  }
  const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
  await admin
    .from("approval_notifications")
    .update({ status: "pending", locked_at: null, next_attempt_at: next })
    .eq("id", id);
}
