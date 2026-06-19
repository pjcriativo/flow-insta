import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// GET /api/admin/orgs — lista organizações + contagem de membros (super-admin).
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();

    const { data: orgs, error } = await admin
      .from("organizations")
      .select("id, name, type, created_at, created_by")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to list organizations" }, { status: 500 });
    }

    // Contagem de membros por org.
    const withCounts = await Promise.all(
      (orgs ?? []).map(async (org) => {
        const { count } = await admin
          .from("organization_members")
          .select("*", { count: "exact", head: true })
          .eq("org_id", org.id);
        return { ...org, memberCount: count ?? 0 };
      })
    );

    return NextResponse.json({ organizations: withCounts });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error listing admin orgs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
