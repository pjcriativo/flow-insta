import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/settings — lê todas as configurações (somente admin).
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();
    const { data } = await admin.from("platform_settings").select("key, value");
    const settings = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
    return NextResponse.json({ settings });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/admin/settings — atualiza uma ou mais configurações.
// Body: { key: value, ... }  (value pode ser qualquer JSON)
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = (await request.json()) as Record<string, unknown>;
    const admin = getSupabaseAdminClient();

    for (const [key, value] of Object.entries(body)) {
      await admin
        .from("platform_settings")
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }

    await logAudit({ actorId: userId, action: "settings.update", targetType: "settings", details: body });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
