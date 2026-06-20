import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { generateVariations } from "@/lib/dm-pilot/keywords";

// keyword_responses por org (channel_id opcional). Escrita exige owner/admin
// (RLS). O backend preenche `variations` via generateVariations (como no zip).

const keywordSchema = z.object({
  id: z.string().uuid().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  keyword: z.string().min(1).max(200),
  response_message: z.string().min(1).max(2000),
  active: z.boolean().optional().default(true),
});

// GET /api/automation/keywords
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("keyword_responses")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[automation/keywords] GET", error.message);
      return NextResponse.json({ error: "Failed to load keywords" }, { status: 500 });
    }
    return NextResponse.json({ keywords: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/automation/keywords — cria (sem id) ou atualiza (com id).
export async function PUT(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const body = keywordSchema.parse(await request.json());

    // Variações geradas no servidor a partir da keyword (determinístico).
    const variations = generateVariations(body.keyword);

    const { data, error } = await supabase
      .from("keyword_responses")
      .upsert({ organization_id: orgId, ...body, variations })
      .select("*")
      .single();

    if (error) {
      console.error("[automation/keywords] PUT", error.message);
      return NextResponse.json({ error: "Failed to save keyword" }, { status: 403 });
    }
    return NextResponse.json({ entry: data });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/automation/keywords?id=...
export async function DELETE(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { error } = await supabase
      .from("keyword_responses")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", id);
    if (error) {
      console.error("[automation/keywords] DELETE", error.message);
      return NextResponse.json({ error: "Failed to delete" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
