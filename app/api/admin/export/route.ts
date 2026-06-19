import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/export?type=users|orgs — baixa um CSV.
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();
    const type = request.nextUrl.searchParams.get("type") ?? "users";

    let csv = "";
    let filename = "export.csv";

    if (type === "orgs") {
      const { data: orgs } = await admin
        .from("organizations")
        .select("id, name, type, created_at")
        .order("created_at", { ascending: false });

      const rows = await Promise.all(
        (orgs ?? []).map(async (o) => {
          const { count } = await admin
            .from("organization_members")
            .select("*", { count: "exact", head: true })
            .eq("org_id", o.id);
          return [o.id, o.name, o.type, count ?? 0, o.created_at] as (string | number)[];
        })
      );
      csv = toCsv(["id", "nome", "tipo", "membros", "criado_em"], rows);
      filename = "organizacoes.csv";
    } else {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const rows = (data?.users ?? []).map((u) => [
        u.id,
        u.email ?? "",
        u.email_confirmed_at ? "sim" : "nao",
        u.created_at,
        u.last_sign_in_at ?? "",
      ]);
      csv = toCsv(["id", "email", "confirmado", "criado_em", "ultimo_acesso"], rows);
      filename = "usuarios.csv";
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
