import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// POST /api/content-slides/:id/regenerate-image
// Enfileira a regeração da imagem de UM slide: marca o slide 'pending' e o
// projeto 'generating', e responde 202. O tick reprocessa o projeto — a
// idempotência por slide pula os já 'completed' e regenera só este (respeitando
// a continuidade com o slide 1). org_id do servidor.
// =========================================================

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    await enforceLimit(supabase, orgId, "ai");

    const { data: slide, error: slideErr } = await supabase
      .from("content_slides")
      .select("id, project_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (slideErr) {
      console.error("[regenerate-image] load", slideErr.message);
      return NextResponse.json({ error: "Falha ao carregar slide" }, { status: 500 });
    }
    if (!slide) return NextResponse.json({ error: "Slide não encontrado" }, { status: 404 });

    // Marca o slide para regerar (pending) — o runner gera só os não-completed.
    const { error: slideUpd } = await supabase
      .from("content_slides")
      .update({ generation_status: "pending", generation_error: null, image_path: null })
      .eq("id", id)
      .eq("organization_id", orgId);
    if (slideUpd) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    // Reenfileira o projeto.
    await supabase
      .from("content_projects")
      .update({ status: "generating", generation_error: null })
      .eq("id", slide.project_id)
      .eq("organization_id", orgId);

    return NextResponse.json({ status: "generating" }, { status: 202 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("[regenerate-image] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
