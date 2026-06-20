import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";

// GET /api/inbox/review — itens pendentes da fila de revisão da org (RLS),
// com o evento de origem para dar contexto ao revisor.
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();

    const { data, error } = await supabase
      .from("review_queue")
      .select(
        "id, status, suggested_action, created_at, interaction_events(id, type, external_username, text, intent, intent_confidence)"
      )
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[inbox/review] GET", error.message);
      return NextResponse.json({ error: "Failed to load review queue" }, { status: 500 });
    }
    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
