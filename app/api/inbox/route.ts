import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";

// GET /api/inbox — caixa unificada: eventos recentes da org (RLS) com as ações
// tomadas. Filtro opcional por status via ?status=.
export async function GET(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const status = request.nextUrl.searchParams.get("status");

    let query = supabase
      .from("interaction_events")
      .select(
        "id, type, external_username, text, intent, intent_confidence, sentiment, status, received_at, interaction_actions(action_type, status, provider_message_id, error, created_at)"
      )
      .eq("organization_id", orgId)
      .order("received_at", { ascending: false })
      .limit(100);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("[inbox] GET", error.message);
      return NextResponse.json({ error: "Failed to load inbox" }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
