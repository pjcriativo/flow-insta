import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// =========================================================
// Marca (brand_profiles) — listar / criar.
// RLS: leitura por membro; escrita só owner/admin (policy brand_profiles_write).
// O organization_id é carimbado do servidor (getActiveOrg), nunca do input.
// =========================================================

const CreateBrandSchema = z.object({
  brand_name: z.string().min(1, "Nome da marca é obrigatório").max(120),
  channel_id: z.string().uuid().nullable().optional(),
  instagram_handle: z.string().max(60).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  target_audience: z.string().max(1000).nullable().optional(),
  tone_of_voice: z.string().max(1000).nullable().optional(),
  color_palette: z
    .array(z.object({ name: z.string().optional(), hex: z.string().optional(), role: z.string().optional() }))
    .optional(),
  logo_path: z.string().nullable().optional(),
  logo_placement: z.string().max(500).nullable().optional(),
  typography: z
    .object({ primary_font: z.string().optional(), secondary_font: z.string().optional(), style_notes: z.string().optional() })
    .optional(),
  visual_style: z.string().max(1000).nullable().optional(),
  mood_keywords: z.array(z.string()).optional(),
  reference_images: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[brand-profiles] list error", error.message);
      return NextResponse.json({ error: "Falha ao listar marcas" }, { status: 500 });
    }
    return NextResponse.json({ brandProfiles: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[brand-profiles] GET", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const body = await request.json();
    const parsed = CreateBrandSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("brand_profiles")
      .insert({ ...parsed.data, organization_id: orgId })
      .select()
      .single();

    if (error) {
      // RLS (member sem permissão) ou unique (perfil org-wide/canal duplicado).
      console.error("[brand-profiles] create error", error.message);
      const status = error.code === "23505" ? 409 : 403;
      const message =
        error.code === "23505"
          ? "Já existe uma marca para esta org/canal"
          : "Sem permissão para criar marca";
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ brandProfile: data }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[brand-profiles] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
