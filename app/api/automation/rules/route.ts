import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { INTENTS, ACTION_TYPES } from "@/types/dm-pilot";

// Regras por intenção (1 por intenção/canal). Escrita exige owner/admin (RLS).

const ruleSchema = z.object({
  channel_id: z.string().uuid(),
  intent: z.enum(INTENTS),
  action_type: z.enum(ACTION_TYPES),
  prompt_template: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

// GET /api/automation/rules?channel_id=...
export async function GET(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const channelId = request.nextUrl.searchParams.get("channel_id");
    let query = supabase
      .from("automation_rules")
      .select("*")
      .eq("organization_id", orgId)
      .order("priority", { ascending: true });
    if (channelId) query = query.eq("channel_id", channelId);

    const { data, error } = await query;
    if (error) {
      console.error("[automation/rules] GET", error.message);
      return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
    }
    return NextResponse.json({ rules: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/automation/rules — upsert de uma regra (única por org+canal+intenção).
export async function PUT(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const body = ruleSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("automation_rules")
      .upsert(
        { organization_id: orgId, ...body },
        { onConflict: "organization_id,channel_id,intent" }
      )
      .select("*")
      .single();

    if (error) {
      console.error("[automation/rules] PUT", error.message);
      return NextResponse.json({ error: "Failed to save rule" }, { status: 403 });
    }
    return NextResponse.json({ rule: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
