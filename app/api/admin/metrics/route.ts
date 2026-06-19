import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/admin/metrics — métricas da plataforma com variação vs período anterior.
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();

    const now = Date.now();
    const d30 = new Date(now - 30 * 86400000).toISOString();
    const d60 = new Date(now - 60 * 86400000).toISOString();

    const count = async (
      table: string,
      filters?: Record<string, string | boolean>
    ): Promise<number> => {
      let q = admin.from(table).select("*", { count: "exact", head: true });
      for (const [k, v] of Object.entries(filters ?? {})) q = q.eq(k, v);
      const { count } = await q;
      return count ?? 0;
    };

    // Contagem em janela de tempo por created_at.
    const countBetween = async (table: string, from: string, to?: string) => {
      let q = admin.from(table).select("*", { count: "exact", head: true }).gte("created_at", from);
      if (to) q = q.lt("created_at", to);
      const { count } = await q;
      return count ?? 0;
    };

    const { data: userCount } = await admin.rpc("admin_user_count");
    const totalUsers = typeof userCount === "number" ? userCount : 0;

    const [
      totalOrgs, personalOrgs, teamOrgs,
      totalPosts, publishedPosts, queuedPosts, failedPosts,
      connectedChannels,
      orgsLast30, orgsPrev30,
      postsLast30, postsPrev30,
      freeOrgs, proOrgs, businessOrgs,
      activeOrgs,
    ] = await Promise.all([
      count("organizations"),
      count("organizations", { type: "personal" }),
      count("organizations", { type: "team" }),
      count("scheduled_posts"),
      count("scheduled_posts", { status: "published" }),
      count("scheduled_posts", { status: "queue" }),
      count("scheduled_posts", { status: "failed" }),
      count("user_channels", { is_connected: true }),
      countBetween("organizations", d30),
      countBetween("organizations", d60, d30),
      countBetween("scheduled_posts", d30),
      countBetween("scheduled_posts", d60, d30),
      count("organizations", { plan: "free" }),
      count("organizations", { plan: "pro" }),
      count("organizations", { plan: "business" }),
      count("user_channels", { is_connected: true }), // proxy de orgs ativas (com canal)
    ]);

    const pct = (cur: number, prev: number): number => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 100);
    };

    // MRR estimado: soma dos preços dos planos pagos × nº de orgs.
    const { data: plans } = await admin.from("plans").select("id, price_cents");
    const priceById = Object.fromEntries((plans ?? []).map((p) => [p.id, p.price_cents]));
    const mrrCents = proOrgs * (priceById["pro"] ?? 0) + businessOrgs * (priceById["business"] ?? 0);

    return NextResponse.json({
      metrics: {
        totalUsers, totalOrgs, personalOrgs, teamOrgs,
        totalPosts, publishedPosts, queuedPosts, failedPosts,
        connectedChannels,
      },
      trends: {
        orgs: { value: orgsLast30, changePct: pct(orgsLast30, orgsPrev30) },
        posts: { value: postsLast30, changePct: pct(postsLast30, postsPrev30) },
      },
      health: {
        freeOrgs, proOrgs, businessOrgs,
        paidOrgs: proOrgs + businessOrgs,
        activationRate: totalOrgs > 0 ? Math.round((activeOrgs / totalOrgs) * 100) : 0,
        mrrCents,
      },
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error fetching admin metrics:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
