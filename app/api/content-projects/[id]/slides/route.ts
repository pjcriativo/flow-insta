import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "flow-insta";

// =========================================================
// GET /api/content-projects/:id/slides — lista os slides de um projeto.
// RLS: leitura por membro. Filtro defensivo por organization_id. Anexa
// image_url público (bucket público) quando o slide já tem image_path.
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

    const slides = (data ?? []).map((s) => ({
      ...s,
      image_url: s.image_path
        ? supabase.storage.from(STORAGE_BUCKET).getPublicUrl(s.image_path).data.publicUrl
        : null,
    }));
    return NextResponse.json({ slides });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[content-projects/:id/slides] GET", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
