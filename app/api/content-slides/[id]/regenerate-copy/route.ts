import { getActiveOrg, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";
import { regenerateSlideCopy } from "@/lib/content/copy";
import { getVoiceInstruction } from "@/lib/atomization/voice";
import { BrandProfile, ContentType, SLIDE_ROLES, SlideRole } from "@/lib/content/types";

// =========================================================
// POST /api/content-slides/:id/regenerate-copy
// Reescreve a copy de UM slide mantendo coerência com os demais e a voz da
// marca. Atualiza só a copy (não toca em image_path).
// =========================================================

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    await enforceLimit(supabase, orgId, "ai");

    // Carrega o slide alvo.
    const { data: slide, error: slideErr } = await supabase
      .from("content_slides")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (slideErr) {
      console.error("[regenerate-copy] load slide", slideErr.message);
      return NextResponse.json({ error: "Falha ao carregar slide" }, { status: 500 });
    }
    if (!slide) return NextResponse.json({ error: "Slide não encontrado" }, { status: 404 });

    // Carrega o projeto (tipo + ideia + marca) e os slides irmãos.
    const { data: project } = await supabase
      .from("content_projects")
      .select("*")
      .eq("id", slide.project_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });

    const { data: siblings } = await supabase
      .from("content_slides")
      .select("slide_number, role, headline")
      .eq("project_id", slide.project_id)
      .eq("organization_id", orgId)
      .neq("id", id)
      .order("slide_number", { ascending: true });

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

    const voiceInstruction = await getVoiceInstruction(getSupabaseAdminClient(), orgId, channelId);

    // O role do slide vem do banco; valida contra o enum conhecido.
    const role: SlideRole = (SLIDE_ROLES as readonly string[]).includes(slide.role)
      ? (slide.role as SlideRole)
      : "post";

    const result = await regenerateSlideCopy({
      brand,
      contentType: project.content_type as ContentType,
      idea: project.idea,
      slide: {
        slide_number: slide.slide_number,
        role,
        headline: slide.headline ?? "",
        body: slide.body ?? "",
        visual_description: slide.visual_description ?? "",
      },
      otherSlides: (siblings ?? []).map((s) => ({
        slide_number: s.slide_number,
        role: s.role as SlideRole,
        headline: s.headline ?? "",
      })),
      voiceInstruction,
    });

    if (!result.ok) {
      return NextResponse.json({ error: `IA: ${result.error}` }, { status: 422 });
    }

    const { data: updated, error: updErr } = await supabase
      .from("content_slides")
      .update({
        headline: result.data.headline,
        body: result.data.body ?? "",
        visual_description: result.data.visual_description,
      })
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .maybeSingle();

    if (updErr) {
      console.error("[regenerate-copy] update", updErr.message);
      return NextResponse.json({ error: "Falha ao gravar slide" }, { status: 500 });
    }
    return NextResponse.json({ slide: updated });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("[regenerate-copy] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
