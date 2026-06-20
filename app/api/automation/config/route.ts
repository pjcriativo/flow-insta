import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";

// Config de automação por canal: enabled, kill-switch, revisão, confiança.
// Escrita exige owner/admin (RLS Admins write automation configs). A API usa
// o client do usuário (RLS) — nada de service_role aqui.

const upsertSchema = z.object({
  channel_id: z.string().uuid(),
  enabled: z.boolean().optional(),
  kill_switch: z.boolean().optional(),
  require_human_review: z.boolean().optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  brand_voice_id: z.string().uuid().nullable().optional(),
});

// GET /api/automation/config — lista as configs da org ativa.
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("automation_configs")
      .select("*")
      .eq("organization_id", orgId);
    if (error) {
      console.error("[automation/config] GET", error.message);
      return NextResponse.json({ error: "Failed to load configs" }, { status: 500 });
    }
    return NextResponse.json({ configs: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/automation/config — cria/atualiza a config de um canal (upsert).
export async function PUT(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const body = upsertSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("automation_configs")
      .upsert(
        { organization_id: orgId, ...body },
        { onConflict: "organization_id,channel_id" }
      )
      .select("*")
      .single();

    if (error) {
      // RLS bloqueia não-admin -> 0 linhas / erro de permissão.
      console.error("[automation/config] PUT", error.message);
      return NextResponse.json({ error: "Failed to save config" }, { status: 403 });
    }
    return NextResponse.json({ config: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
