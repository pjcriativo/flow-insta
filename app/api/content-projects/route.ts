import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CONTENT_TYPES } from "@/lib/content/types";

// =========================================================
// Projetos de conteúdo (content_projects) — listar / criar.
// RLS: leitura membro; criação só owner/admin. organization_id e created_by
// carimbados do servidor.
// =========================================================

const CreateProjectSchema = z
  .object({
    content_type: z.enum(CONTENT_TYPES),
    idea: z.string().min(1, "A ideia é obrigatória").max(4000),
    brand_id: z.string().uuid().nullable().optional(),
    reference_content: z.string().max(8000).nullable().optional(),
    slide_count: z.number().int().min(1).max(20).nullable().optional(),
  })
  .refine((v) => v.content_type !== "carousel" || (v.slide_count ?? 0) >= 2, {
    message: "Carrossel precisa de pelo menos 2 slides",
    path: ["slide_count"],
  });

export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("content_projects")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[content-projects] list error", error.message);
      return NextResponse.json({ error: "Falha ao listar projetos" }, { status: 500 });
    }
    return NextResponse.json({ projects: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[content-projects] GET", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, userId } = await getActiveOrg();
    const parsed = CreateProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("content_projects")
      .insert({
        ...parsed.data,
        // Posts e thumbnails são 1 slide; carrossel usa o slide_count informado.
        slide_count: parsed.data.content_type === "carousel" ? parsed.data.slide_count : 1,
        organization_id: orgId,
        created_by: userId,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      console.error("[content-projects] create error", error.message);
      return NextResponse.json({ error: "Sem permissão para criar projeto" }, { status: 403 });
    }
    return NextResponse.json({ project: data }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[content-projects] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
