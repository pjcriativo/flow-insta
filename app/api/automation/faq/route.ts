import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";

// FAQ por org (channel_id opcional). Escrita exige owner/admin (RLS).

const faqSchema = z.object({
  id: z.string().uuid().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  question: z.string().min(1),
  answer: z.string().min(1),
});

// GET /api/automation/faq
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("faq_entries")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[automation/faq] GET", error.message);
      return NextResponse.json({ error: "Failed to load faq" }, { status: 500 });
    }
    return NextResponse.json({ faq: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/automation/faq — cria (sem id) ou atualiza (com id).
export async function PUT(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const body = faqSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("faq_entries")
      .upsert({ organization_id: orgId, ...body })
      .select("*")
      .single();

    if (error) {
      console.error("[automation/faq] PUT", error.message);
      return NextResponse.json({ error: "Failed to save faq" }, { status: 403 });
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

// DELETE /api/automation/faq?id=...
export async function DELETE(request: NextRequest) {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { error } = await supabase
      .from("faq_entries")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", id);
    if (error) {
      console.error("[automation/faq] DELETE", error.message);
      return NextResponse.json({ error: "Failed to delete" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
