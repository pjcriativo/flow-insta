import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/admin/metrics — métricas da plataforma (somente super-admin).
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();

    const count = async (
      table: string,
      filters?: Record<string, string | boolean>
    ): Promise<number> => {
      let q = admin.from(table).select("*", { count: "exact", head: true });
      for (const [k, v] of Object.entries(filters ?? {})) q = q.eq(k, v);
      const { count } = await q;
      return count ?? 0;
    };

    const { data: userCount } = await admin.rpc("admin_user_count");
    const totalUsers = typeof userCount === "number" ? userCount : null;

    const [
      totalOrgs,
      personalOrgs,
      teamOrgs,
      totalPosts,
      publishedPosts,
      queuedPosts,
      connectedChannels,
    ] = await Promise.all([
      count("organizations"),
      count("organizations", { type: "personal" }),
      count("organizations", { type: "team" }),
      count("scheduled_posts"),
      count("scheduled_posts", { status: "published" }),
      count("scheduled_posts", { status: "queue" }),
      count("user_channels", { is_connected: true }),
    ]);

    return NextResponse.json({
      metrics: {
        totalUsers: totalUsers ?? null,
        totalOrgs,
        personalOrgs,
        teamOrgs,
        totalPosts,
        publishedPosts,
        queuedPosts,
        connectedChannels,
      },
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error fetching admin metrics:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
