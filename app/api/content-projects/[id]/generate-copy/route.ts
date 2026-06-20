import { getActiveOrg, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";
import { generateCopy } from "@/lib/content/copy";
import { getVoiceInstruction } from "@/lib/atomization/voice";
import { BrandProfile, ContentType } from "@/lib/content/types";

// =========================================================
// POST /api/content-projects/:id/generate-copy
// Gera a copy do projeto (na voz da marca), grava os slides e move o projeto
// para 'copy_ready'. A geração roda inline (texto é rápido); só a IMAGEM (Fase
// 2) vai para o motor de jobs.
//
// Idempotente do ponto de vista do usuário: regerar substitui os slides antigos
// (os que ainda não têm imagem). A escrita é via RLS do usuário (owner/admin).
// =========================================================

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    await enforceLimit(supabase, orgId, "ai");

    // Carrega o projeto (RLS garante que é da org).
    const { data: project, error: projErr } = await supabase
      .from("content_projects")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (projErr) {
      console.error("[generate-copy] load project", projErr.message);
      return NextResponse.json({ error: "Falha ao carregar projeto" }, { status: 500 });
    }
    if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });

    // Carrega a marca (se houver) para o bloco de identidade + voz.
    let brand: BrandProfile | null = null;
    let channelId: string | null = null;
    if (project.brand_id) {
      const { data: b } = await supabase
        .from("brand_profiles")
        .select("*")
        .eq("id", project.brand_id)
        .eq("organization_id", orgId)
        .maybeSingle();
      brand = (b as BrandProfile | null) ?? null;
      channelId = (b as { channel_id?: string | null } | null)?.channel_id ?? null;
    }

    // Voz da marca (mais específica disponível). Usa o admin client só p/ leitura.
    const voiceInstruction = await getVoiceInstruction(getSupabaseAdminClient(), orgId, channelId);

    const result = await generateCopy({
      brand,
      contentType: project.content_type as ContentType,
      idea: project.idea,
      referenceContent: project.reference_content,
      slideCount: project.slide_count,
      voiceInstruction,
    });

    if (!result.ok) {
      // Falha de IA: marca o projeto como failed com a razão (sem stack).
      await supabase
        .from("content_projects")
        .update({ status: "failed", generation_error: result.error })
        .eq("id", id)
        .eq("organization_id", orgId);
      return NextResponse.json({ error: `IA: ${result.error}` }, { status: 422 });
    }

    // Substitui os slides existentes que ainda NÃO têm imagem (preserva imagens
    // já geradas em regerações futuras — na Fase 1 nenhum tem imagem ainda).
    await supabase
      .from("content_slides")
      .delete()
      .eq("project_id", id)
      .eq("organization_id", orgId)
      .is("image_path", null);

    const rows = result.data.slides.map((s) => ({
      project_id: id,
      organization_id: orgId,
      slide_number: s.slide_number,
      role: s.role,
      headline: s.headline,
      body: s.body ?? "",
      visual_description: s.visual_description,
      generation_status: "pending" as const,
    }));

    const { data: inserted, error: insErr } = await supabase
      .from("content_slides")
      .insert(rows)
      .select();

    if (insErr) {
      console.error("[generate-copy] insert slides", insErr.message);
      await supabase
        .from("content_projects")
        .update({ status: "failed", generation_error: "Falha ao gravar slides" })
        .eq("id", id)
        .eq("organization_id", orgId);
      return NextResponse.json({ error: "Falha ao gravar slides" }, { status: 500 });
    }

    await supabase
      .from("content_projects")
      .update({ status: "copy_ready", generation_error: null })
      .eq("id", id)
      .eq("organization_id", orgId);

    return NextResponse.json({ slides: inserted, status: "copy_ready" });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("[generate-copy] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
