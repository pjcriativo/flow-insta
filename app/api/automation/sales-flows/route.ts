import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";

// Funis de venda (sales_flows). Escrita exige owner/admin (RLS).

const stepSchema = z.object({
  prompt: z.string(),
  goal: z.string().optional(),
});

const flowSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  steps: z.array(stepSchema).default([]),
  active: z.boolean().optional(),
});

// GET /api/automation/sales-flows
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("sales_flows")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[automation/sales-flows] GET", error.message);
      return NextResponse.json({ error: "Failed to load flows" }, { status: 500 });
    }
    return NextResponse.json({ flows: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/automation/sales-flows — cria (sem id) ou atualiza (com id).
export async function PUT(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const body = flowSchema.parse(await request.json());

    const row = {
      organization_id: orgId,
      name: body.name,
      steps: body.steps,
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.id ? { id: body.id } : {}),
    };

    const { data, error } = await supabase
      .from("sales_flows")
      .upsert(row)
      .select("*")
      .single();

    if (error) {
      console.error("[automation/sales-flows] PUT", error.message);
      return NextResponse.json({ error: "Failed to save flow" }, { status: 403 });
    }
    return NextResponse.json({ flow: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
