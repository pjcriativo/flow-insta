import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// =========================================================
// PUT /api/content-slides/:id — editar a copy de um slide.
// RLS: update por membro (policy content_slides_update). Defesa em profundidade
// com .eq(organization_id).
// =========================================================

const UpdateSlideSchema = z
  .object({
    headline: z.string().min(1).max(200).optional(),
    body: z.string().max(800).nullable().optional(),
    visual_description: z.string().min(1).max(1200).optional(),
    role: z.string().max(40).optional(),
  })
  .strict();

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    const parsed = UpdateSlideSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("content_slides")
      .update(parsed.data)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[content-slides/:id] update", error.message);
      return NextResponse.json({ error: "Falha ao atualizar slide" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Slide não encontrado ou sem permissão" }, { status: 404 });
    return NextResponse.json({ slide: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("[content-slides/:id] PUT", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
