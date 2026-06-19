import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/dashboard — resumo da home: próximos posts, contagens, streak,
// canais conectados e série de posts (14 dias) para um mini-gráfico.
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const nowIso = new Date().toISOString();

    const [counts, upcoming, recentPublished, channels, postsForStreak] =
      await Promise.all([
        // Contagens por status (head + count).
        Promise.all(
          ["draft", "queue", "published", "failed"].map(async (status) => {
            const { count } = await supabase
              .from("scheduled_posts")
              .select("id", { count: "exact", head: true })
              .eq("org_id", orgId)
              .eq("status", status);
            return [status, count ?? 0] as const;
          })
        ),
        // Próximos posts agendados (queue, futuro).
        supabase
          .from("scheduled_posts")
          .select("id, content, scheduled_at, status, images, user_channels(handle, channel_types(type, name, color))")
          .eq("org_id", orgId)
          .eq("status", "queue")
          .gte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(5),
        // Últimos publicados.
        supabase
          .from("scheduled_posts")
          .select("id, content, published_at, published_url, user_channels(channel_types(type, name, color))")
          .eq("org_id", orgId)
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(5),
        // Canais conectados.
        supabase
          .from("user_channels")
          .select("id, channel_type_id, is_connected")
          .eq("org_id", orgId)
          .eq("is_connected", true),
        // Datas de publicação dos últimos 60 dias (para streak + série).
        supabase
          .from("scheduled_posts")
          .select("published_at, created_at, status")
          .eq("org_id", orgId)
          .eq("status", "published")
          .gte("published_at", new Date(Date.now() - 60 * 86400000).toISOString())
          .order("published_at", { ascending: false }),
      ]);

    const countMap = Object.fromEntries(counts);

    // Streak: dias consecutivos (até hoje) com pelo menos 1 post publicado.
    const publishedDays = new Set(
      (postsForStreak.data ?? [])
        .map((p) => p.published_at)
        .filter(Boolean)
        .map((d) => new Date(d as string).toISOString().slice(0, 10))
    );
    let streak = 0;
    const cursor = new Date();
    // Se ainda não postou hoje, a sequência pode contar a partir de ontem.
    if (!publishedDays.has(cursor.toISOString().slice(0, 10))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    while (publishedDays.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    // Série dos últimos 14 dias (posts publicados por dia).
    const series: { date: string; published: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const n = (postsForStreak.data ?? []).filter(
        (p) => p.published_at && new Date(p.published_at).toISOString().slice(0, 10) === key
      ).length;
      series.push({ date: key.slice(5), published: n });
    }

    return NextResponse.json({
      counts: {
        draft: countMap.draft ?? 0,
        queue: countMap.queue ?? 0,
        published: countMap.published ?? 0,
        failed: countMap.failed ?? 0,
      },
      upcoming: upcoming.data ?? [],
      recentPublished: recentPublished.data ?? [],
      connectedChannels: channels.data?.length ?? 0,
      streak,
      series,
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error building dashboard:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
