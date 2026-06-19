import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/plans — lista planos + contagem de orgs por plano.
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();

    const { data: plans } = await admin
      .from("plans")
      .select("*")
      .order("sort_order", { ascending: true });

    const withCounts = await Promise.all(
      (plans ?? []).map(async (p) => {
        const { count } = await admin
          .from("organizations")
          .select("*", { count: "exact", head: true })
          .eq("plan", p.id);
        return { ...p, orgCount: count ?? 0 };
      })
    );

    return NextResponse.json({ plans: withCounts });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/admin/plans — atualiza limites de um plano.
// Body: { id, name?, price_cents?, max_channels?, max_posts?, max_members?, ai_enabled? }
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requirePlatformAdmin();
    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const allowed = ["name", "price_cents", "max_channels", "max_posts", "max_members", "ai_enabled"];
    const update: Record<string, unknown> = {};
    for (const k of allowed) if (k in fields) update[k] = fields[k];

    const admin = getSupabaseAdminClient();
    const { error } = await admin.from("plans").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });

    await logAudit({ actorId: userId, action: "plan.update", targetType: "plan", targetId: id, details: update });
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
