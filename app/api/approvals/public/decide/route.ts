import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { validateTokenOnly } from "@/lib/approvals/public-guard";
import { rateLimit, getClientIp } from "@/lib/approvals/rate-limit";
import { recomputeCollectionStatus } from "@/lib/approvals/rollup";
import { enqueueApprovalNotification } from "@/lib/jobs/approval-notify";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  token: z.string().min(1),
  collection_item_id: z.string().uuid(),
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  comment: z.string().max(2000).optional(),
  decided_by_email: z.string().email().optional(),
});

// Resposta genérica para falhas de validação/token (anti-enumeração).
const GENERIC = NextResponse.json({ error: "Requisição inválida" }, { status: 400 });

// POST /api/approvals/public/decide — PÚBLICO. Registra uma decisão do cliente.
export async function POST(request: NextRequest) {
  // Rate-limit por IP.
  const ip = getClientIp(request.headers);
  const rl = rateLimit(`decide:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Muitas requisições. Tente novamente em instantes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return GENERIC;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return GENERIC;

  const { token, collection_item_id, decision, comment, decided_by_email } = parsed.data;

  // Valida o token (assinatura + estado do link). Nunca confia em org/collection do corpo.
  const ctx = await validateTokenOnly(token);
  if (!ctx) return GENERIC;

  const admin = getSupabaseAdminClient();

  // ESCOPO MANUAL: o item precisa pertencer ao collection_id/org do token.
  const { data: item } = await admin
    .from("approval_collection_items")
    .select("id, collection_id, organization_id")
    .eq("id", collection_item_id)
    .eq("collection_id", ctx.collection_id)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();

  if (!item) {
    // Item de outra coleção (ou inexistente) => genérico, sem vazar.
    return GENERIC;
  }

  // Sessão mais recente deste link (para vincular a decisão).
  const { data: session } = await admin
    .from("approval_sessions")
    .select("id")
    .eq("link_id", ctx.link_id)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Append-only: INSERT em approval_decisions (nunca update/delete).
  const { data: decisionRow, error: decErr } = await admin
    .from("approval_decisions")
    .insert({
      collection_item_id,
      collection_id: ctx.collection_id,
      organization_id: ctx.organization_id,
      session_id: session?.id ?? null,
      decision,
      comment: comment ?? null,
      decided_by_email: decided_by_email ?? null,
    })
    .select("id")
    .single();
  if (decErr) {
    console.error("Error inserting decision:", decErr);
    return NextResponse.json({ error: "Falha ao registrar decisão" }, { status: 500 });
  }

  // Atualiza o status do item (espelha a última decisão).
  await admin
    .from("approval_collection_items")
    .update({ item_status: decision })
    .eq("id", collection_item_id)
    .eq("organization_id", ctx.organization_id);

  // Se veio comentário junto, registra como comentário do cliente.
  if (comment && comment.trim()) {
    await admin.from("approval_comments").insert({
      collection_item_id,
      organization_id: ctx.organization_id,
      author_type: "client",
      author_session_id: session?.id ?? null,
      body: comment.trim(),
    });
  }

  // Recalcula o status da coleção a partir dos itens.
  await recomputeCollectionStatus(ctx.collection_id);

  // Notificação DURÁVEL: enfileira (não bloqueia a request, invariante #8).
  // O tick reivindica e envia com retry. Falha de enqueue não quebra a decisão.
  await enqueueApprovalNotification({
    collection_id: ctx.collection_id,
    organization_id: ctx.organization_id,
    collection_item_id,
    decision,
    decision_id: decisionRow?.id ?? null,
  });

  return NextResponse.json({ success: true });
}
