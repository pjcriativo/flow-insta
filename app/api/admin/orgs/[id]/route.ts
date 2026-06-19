import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/orgs/[id] — detalhe da org (membros com email + métricas).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: org } = await admin
      .from("organizations")
      .select("id, name, type, created_at, created_by")
      .eq("id", id)
      .maybeSingle();

    if (!org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }

    const { data: memberRows } = await admin
      .from("organization_members")
      .select("user_id, role, created_at")
      .eq("org_id", id);

    const members = await Promise.all(
      (memberRows ?? []).map(async (m) => {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        return {
          userId: m.user_id,
          email: u?.user?.email ?? null,
          role: m.role,
        };
      })
    );

    const [posts, channels, ideas] = await Promise.all([
      admin.from("scheduled_posts").select("*", { count: "exact", head: true }).eq("org_id", id),
      admin.from("user_channels").select("*", { count: "exact", head: true }).eq("org_id", id).eq("is_connected", true),
      admin.from("ideas").select("*", { count: "exact", head: true }).eq("org_id", id),
    ]);

    return NextResponse.json({
      org,
      members,
      stats: {
        posts: posts.count ?? 0,
        connectedChannels: channels.count ?? 0,
        ideas: ideas.count ?? 0,
      },
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
