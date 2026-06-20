import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// POST /api/content-projects/:id/generate-images
// Enfileira a geração de imagem: move o projeto para 'generating' e responde
// 202. NÃO processa inline — o motor (pg_cron -> /api/cron/tick) reivindica o
// projeto e gera as imagens slide a slide (idempotente).
//
// Pré-condição: o projeto precisa ter slides (copy gerada). org_id do servidor.
// =========================================================

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    await enforceLimit(supabase, orgId, "ai");

    const { data: project, error: projErr } = await supabase
      .from("content_projects")
      .select("id, status")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (projErr) {
      console.error("[generate-images] load", projErr.message);
      return NextResponse.json({ error: "Falha ao carregar projeto" }, { status: 500 });
    }
    if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });

    // Precisa ter slides para gerar imagem.
    const { count } = await supabase
      .from("content_slides")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("organization_id", orgId);
    if (!count || count === 0) {
      return NextResponse.json({ error: "Gere a copy antes das imagens" }, { status: 409 });
    }

    // Enfileira: 'generating' é o status reivindicável pelo claim do tick.
    // Idempotente: se já está 'generating', o claim cuida (lease evita dupla).
    const { error: updErr } = await supabase
      .from("content_projects")
      .update({ status: "generating", generation_error: null })
      .eq("id", id)
      .eq("organization_id", orgId);
    if (updErr) {
      console.error("[generate-images] enqueue", updErr.message);
      return NextResponse.json({ error: "Sem permissão para gerar imagens" }, { status: 403 });
    }

    return NextResponse.json({ status: "generating", queued: count }, { status: 202 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("[generate-images] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
