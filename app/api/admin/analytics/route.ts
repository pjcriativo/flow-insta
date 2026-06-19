import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/admin/analytics — séries temporais (crescimento) + atividade recente.
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();

    // Últimos 30 dias.
    const now = new Date();
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    // Carrega created_at de orgs e posts (e usuários via função admin).
    const [orgsRes, postsRes, usersRes] = await Promise.all([
      admin.from("organizations").select("created_at, type"),
      admin.from("scheduled_posts").select("created_at"),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const orgRows = orgsRes.data ?? [];
    const postRows = postsRes.data ?? [];
    const userRows = (usersRes.data?.users ?? []).map((u) => ({ created_at: u.created_at }));

    const bucketByDay = (rows: { created_at?: string | null }[]) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        if (!r.created_at) continue;
        const key = new Date(r.created_at).toISOString().slice(0, 10);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return map;
    };

    const usersByDay = bucketByDay(userRows);
    const orgsByDay = bucketByDay(orgRows);
    const postsByDay = bucketByDay(postRows);

    // Série acumulada de usuários + diária de orgs/posts.
    let cumUsers = userRows.length - days.reduce((acc, d) => acc + (usersByDay.get(d) ?? 0), 0);
    const growth = days.map((day) => {
      cumUsers += usersByDay.get(day) ?? 0;
      return {
        date: day.slice(5), // MM-DD
        users: cumUsers,
        newOrgs: orgsByDay.get(day) ?? 0,
        newPosts: postsByDay.get(day) ?? 0,
      };
    });

    // Atividade recente: últimas orgs criadas.
    const recentOrgs = [...orgRows]
      .filter((o) => o.created_at)
      .sort((a, b) => (a.created_at! < b.created_at! ? 1 : -1))
      .slice(0, 8);

    // Distribuição B2C vs B2B.
    const personal = orgRows.filter((o) => o.type === "personal").length;
    const team = orgRows.filter((o) => o.type === "team").length;

    return NextResponse.json({
      growth,
      distribution: [
        { name: "Pessoal (B2C)", value: personal },
        { name: "Equipe (B2B)", value: team },
      ],
      recentOrgs,
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error fetching admin analytics:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
