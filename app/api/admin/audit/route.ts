import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/admin/audit — últimos registros de auditoria.
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();
    const { data } = await admin
      .from("audit_logs")
      .select("id, actor_email, action, target_type, target_id, details, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    return NextResponse.json({ logs: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
