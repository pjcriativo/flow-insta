import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// GET /api/content-projects/:id/slides — lista os slides de um projeto.
// RLS: leitura por membro. Filtro defensivo por organization_id.
// =========================================================

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("content_slides")
      .select("*")
      .eq("project_id", id)
      .eq("organization_id", orgId)
      .order("slide_number", { ascending: true });

    if (error) {
      console.error("[content-projects/:id/slides] list", error.message);
      return NextResponse.json({ error: "Falha ao listar slides" }, { status: 500 });
    }
    return NextResponse.json({ slides: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[content-projects/:id/slides] GET", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
