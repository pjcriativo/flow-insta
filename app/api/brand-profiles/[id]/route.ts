import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// =========================================================
// Marca (brand_profiles) — ler / atualizar / excluir uma marca.
// RLS: leitura membro; update/delete só owner/admin. Defesa em profundidade:
// também filtramos por organization_id no .eq.
// =========================================================

const UpdateBrandSchema = z
  .object({
    brand_name: z.string().min(1).max(120).optional(),
    channel_id: z.string().uuid().nullable().optional(),
    instagram_handle: z.string().max(60).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    target_audience: z.string().max(1000).nullable().optional(),
    tone_of_voice: z.string().max(1000).nullable().optional(),
    color_palette: z.array(z.object({ name: z.string().optional(), hex: z.string().optional(), role: z.string().optional() })).optional(),
    logo_path: z.string().nullable().optional(),
    logo_placement: z.string().max(500).nullable().optional(),
    typography: z.object({ primary_font: z.string().optional(), secondary_font: z.string().optional(), style_notes: z.string().optional() }).optional(),
    visual_style: z.string().max(1000).nullable().optional(),
    mood_keywords: z.array(z.string()).optional(),
    reference_images: z.array(z.string()).optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      console.error("[brand-profiles/:id] get error", error.message);
      return NextResponse.json({ error: "Falha ao carregar marca" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Marca não encontrada" }, { status: 404 });
    return NextResponse.json({ brandProfile: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[brand-profiles/:id] GET", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    const parsed = UpdateBrandSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("brand_profiles")
      .update(parsed.data)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[brand-profiles/:id] update error", error.message);
      const status = error.code === "23505" ? 409 : 403;
      return NextResponse.json({ error: status === 409 ? "Marca org/canal duplicada" : "Sem permissão" }, { status });
    }
    // 0 linhas afetadas: ou não existe ou o member não tem permissão (RLS).
    if (!data) return NextResponse.json({ error: "Marca não encontrada ou sem permissão" }, { status: 404 });
    return NextResponse.json({ brandProfile: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[brand-profiles/:id] PUT", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    const { error } = await supabase
      .from("brand_profiles")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      console.error("[brand-profiles/:id] delete error", error.message);
      return NextResponse.json({ error: "Sem permissão para excluir" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[brand-profiles/:id] DELETE", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
