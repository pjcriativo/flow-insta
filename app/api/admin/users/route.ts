import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/users — lista usuários da plataforma (somente super-admin).
export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin();
    const admin = getSupabaseAdminClient();

    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const perPage = 50;

    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
    }

    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      confirmed: !!u.email_confirmed_at,
    }));

    return NextResponse.json({ users, page });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error listing users:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
