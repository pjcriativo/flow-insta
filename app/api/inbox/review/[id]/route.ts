import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { ACTION_TYPES, type ActionType } from "@/types/dm-pilot";
import { sendApprovedAction } from "@/lib/jobs/dm-pilot/decide-and-act";

// POST /api/inbox/review/[id] — decide um item da fila de revisão.
//   approve: envia a sugestão como está.
//   edit:    envia o texto editado pelo revisor.
//   reject:  descarta; o evento vira 'ignored', nada é enviado.
//
// Autorização: getActiveOrg garante usuário autenticado e resolve a org ativa.
// Confirmamos que o item da fila pertence à org ativa ANTES de usar o admin
// client (que ignora RLS) para o envio. O envio reusa sendApprovedAction, que
// respeita kill-switch, janela de 24h e token-na-borda.

const decisionSchema = z.object({
  decision: z.enum(["approve", "edit", "reject"]),
  text: z.string().optional(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { supabase, orgId, userId } = await getActiveOrg();
    const body = decisionSchema.parse(await request.json());

    // Lê o item via client do usuário (RLS) — garante que é da org dele.
    const { data: item, error: itemErr } = await supabase
      .from("review_queue")
      .select("id, organization_id, event_id, status, suggested_action")
      .eq("id", id)
      .maybeSingle();

    if (itemErr || !item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (item.organization_id !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (item.status !== "pending") {
      return NextResponse.json({ error: "Already decided" }, { status: 409 });
    }

    const admin = getSupabaseAdminClient();

    // --- Rejeição: nada é enviado; evento ignorado. ---
    if (body.decision === "reject") {
      await admin
        .from("review_queue")
        .update({ status: "rejected", reviewer_id: userId, decided_at: new Date().toISOString() })
        .eq("id", id);
      await admin.from("interaction_events").update({ status: "ignored" }).eq("id", item.event_id);
      return NextResponse.json({ ok: true, sent: false });
    }

    // --- Aprovação / edição: dispara o envio. ---
    const suggested = (item.suggested_action ?? {}) as { action_type?: string; text?: string };
    const actionType = suggested.action_type as ActionType | undefined;
    if (!actionType || !ACTION_TYPES.includes(actionType)) {
      return NextResponse.json({ error: "Invalid suggested action" }, { status: 422 });
    }

    const finalText = body.decision === "edit" ? (body.text ?? "").trim() : (suggested.text ?? "").trim();
    if (!finalText) {
      return NextResponse.json({ error: "Texto vazio" }, { status: 422 });
    }

    const result = await sendApprovedAction({
      eventId: item.event_id,
      organizationId: orgId,
      actionType,
      text: finalText,
      nowMs: Date.now(),
    });

    await admin
      .from("review_queue")
      .update({
        status: body.decision === "edit" ? "edited" : "approved",
        reviewer_id: userId,
        final_text: finalText,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);

    return NextResponse.json({ ok: result.ok, sent: result.ok, reason: result.reason });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    console.error("[inbox/review] POST", String(error));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
