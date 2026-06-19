import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/analytics — desempenho da org: posts por dia (30d), por canal,
// por status. Usa os dados que já temos (engajamento real exigiria APIs das
// redes; fica como evolução futura).
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();

    const since = new Date(Date.now() - 30 * 86400000).toISOString();

    const { data: posts } = await supabase
      .from("scheduled_posts")
      .select("status, scheduled_at, published_at, created_at, user_channels(channel_types(name, color))")
      .eq("org_id", orgId);

    const rows = posts ?? [];

    // Série diária (30 dias): criados vs publicados.
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const byDay = (field: "created_at" | "published_at") => {
      const map = new Map<string, number>();
      for (const p of rows) {
        const v = p[field];
        if (!v) continue;
        const key = new Date(v).toISOString().slice(0, 10);
        if (new Date(v).toISOString() < since) continue;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return map;
    };
    const created = byDay("created_at");
    const published = byDay("published_at");
    const timeline = days.map((d) => ({
      date: d.slice(5),
      created: created.get(d) ?? 0,
      published: published.get(d) ?? 0,
    }));

    // Por status.
    const statusOrder = ["draft", "queue", "published", "failed"];
    const byStatus = statusOrder.map((s) => ({
      status: s,
      count: rows.filter((p) => p.status === s).length,
    }));

    // Por canal.
    const channelMap = new Map<string, { name: string; color: string; count: number }>();
    for (const p of rows) {
      const ct = (p.user_channels as unknown as { channel_types?: { name?: string; color?: string } })?.channel_types;
      const name = ct?.name ?? "Sem canal";
      const color = ct?.color ?? "#999999";
      const cur = channelMap.get(name) ?? { name, color, count: 0 };
      cur.count++;
      channelMap.set(name, cur);
    }
    const byChannel = Array.from(channelMap.values()).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      timeline,
      byStatus,
      byChannel,
      totals: {
        total: rows.length,
        published: rows.filter((p) => p.status === "published").length,
        last30: timeline.reduce((acc, d) => acc + d.published, 0),
      },
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error building analytics:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
