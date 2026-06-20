import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";

// PATCH /api/automation/conversations/:id — liga/desliga o agente numa conversa
// (agent_active) ou marca não-contatar (do_not_contact). Membro pode (RLS
// "Members update conversations"). Filtro defensivo por organization_id.

const patchSchema = z
  .object({
    agent_active: z.boolean().optional(),
    do_not_contact: z.boolean().optional(),
  })
  .refine((v) => v.agent_active !== undefined || v.do_not_contact !== undefined, {
    message: "Nada para atualizar",
  });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId } = await getActiveOrg();
    const body = patchSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("conversations")
      .update(body)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("id, agent_active, do_not_contact")
      .maybeSingle();

    if (error) {
      console.error("[automation/conversations] PATCH", error.message);
      return NextResponse.json({ error: "Falha ao atualizar" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
    return NextResponse.json({ conversation: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
