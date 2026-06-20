/**
 * Smoke test do delta da Fase 5 (fila durável de notificação de aprovação).
 *
 * Prova:
 *   1. enqueueApprovalNotification insere uma linha 'pending' (não envia inline).
 *   2. claim_approval_notifications reivindica (pending -> processing, lease) e
 *      uma 2ª chamada NÃO repega (dois ticks não enviam duplicado).
 *   3. runApprovalNotifyTick marca 'sent' (no-op de e-mail sem RESEND_API_KEY
 *      conta como entregue — sem retry infinito), sem reprocessar na 2ª passada.
 *
 * Usa uma coleção/decisão de teste descartável, limpa ao final.
 * Uso: env -u SUPABASE_ACCESS_TOKEN npx tsx scripts/smoke-approval-notify.ts
 */
import "dotenv/config";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { enqueueApprovalNotification } from "@/lib/jobs/approval-notify";
import { runApprovalNotifyTick } from "@/lib/jobs/approval-notify-tick";

const TAG = "[smoke-appnotify]";
function check(label: string, cond: boolean): boolean {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  return cond;
}

async function main() {
  const admin = getSupabaseAdminClient();
  let ok = true;

  // Org + usuário reais (created_by é NOT NULL -> auth.users).
  const { data: member } = await admin
    .from("organization_members")
    .select("org_id, user_id")
    .limit(1)
    .maybeSingle();
  if (!member) throw new Error("sem organization_members para o teste");
  const orgId = member.org_id as string;
  const userId = member.user_id as string;

  // Coleção descartável.
  const { data: coll, error: cErr } = await admin
    .from("approval_collections")
    .insert({
      organization_id: orgId,
      created_by: userId,
      client_name: `${TAG} cliente`,
      title: `${TAG} coleção`,
      status: "in_review",
    })
    .select("id")
    .single();
  if (cErr || !coll) throw new Error(`criar coleção: ${cErr?.message}`);
  const collectionId = coll.id as string;

  try {
    console.log(`${TAG} == 1. enqueue insere 'pending' ==`);
    // collection_item_id é nullable (FK on delete set null); no teste usamos
    // null para não depender de um item real. A rota real sempre tem um item.
    await enqueueApprovalNotification({
      collection_id: collectionId,
      organization_id: orgId,
      collection_item_id: null,
      decision: "approved",
      decision_id: null,
    });
    const { data: pend } = await admin
      .from("approval_notifications")
      .select("id, status")
      .eq("collection_id", collectionId);
    ok = check("1 notificação criada", (pend ?? []).length === 1) && ok;
    ok = check("status = 'pending'", pend?.[0]?.status === "pending") && ok;

    console.log(`${TAG} == 2. claim idempotente ==`);
    const { data: c1 } = await admin.rpc("claim_approval_notifications", { p_limit: 50, p_lease: "2 minutes" });
    const claimed1 = (c1 ?? []).some((n: { collection_id: string }) => n.collection_id === collectionId);
    ok = check("1ª claim reivindica", claimed1) && ok;
    const { data: c2 } = await admin.rpc("claim_approval_notifications", { p_limit: 50, p_lease: "2 minutes" });
    const claimed2 = (c2 ?? []).some((n: { collection_id: string }) => n.collection_id === collectionId);
    ok = check("2ª claim NÃO repega (lease)", !claimed2) && ok;

    // Reseta para 'pending' (a claim de teste consumiu o lease) p/ o tick processar.
    await admin
      .from("approval_notifications")
      .update({ status: "pending", locked_at: null, attempts: 0 })
      .eq("collection_id", collectionId);

    console.log(`${TAG} == 3. tick envia e marca 'sent' ==`);
    const r1 = await runApprovalNotifyTick();
    ok = check(`tick processou >=1 (claimed=${r1.claimed})`, r1.claimed >= 1) && ok;
    const { data: after } = await admin
      .from("approval_notifications")
      .select("status")
      .eq("collection_id", collectionId)
      .maybeSingle();
    // Sem RESEND_API_KEY o e-mail é no-op intencional -> conta como 'sent'.
    ok = check(`status final = 'sent' (got ${after?.status})`, after?.status === "sent") && ok;

    console.log(`${TAG} == 4. 2ª passada do tick não reprocessa ==`);
    const r2 = await runApprovalNotifyTick();
    const reprocessed = r2.claimed >= 1;
    ok = check("nada reivindicado de novo (já 'sent')", !reprocessed) && ok;
  } finally {
    await admin.from("approval_notifications").delete().eq("collection_id", collectionId);
    await admin.from("approval_collections").delete().eq("id", collectionId);
    console.log(`${TAG} limpeza concluída`);
  }

  console.log(ok ? `\n${TAG} SMOKE TEST PASSOU ✓` : `\n${TAG} SMOKE TEST FALHOU ✗`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`${TAG} ERRO inesperado:`, e);
  process.exit(1);
});
