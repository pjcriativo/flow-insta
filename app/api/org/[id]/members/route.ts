import { getSupabaseServerClient, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/org/[id]/members — lista membros da org (qualquer membro pode ver).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orgId } = await params;
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RLS members_select garante que só membros veem a lista.
    const { data, error } = await supabase
      .from("organization_members")
      .select("user_id, role, created_at")
      .eq("org_id", orgId);

    if (error) {
      return NextResponse.json({ error: "Failed to list members" }, { status: 500 });
    }

    // Enriquecer com e-mail via admin (auth.users não é acessível por RLS).
    const admin = getSupabaseAdminClient();
    const members = await Promise.all(
      (data ?? []).map(async (m) => {
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        return {
          userId: m.user_id,
          email: u?.user?.email ?? null,
          role: m.role,
          createdAt: m.created_at,
        };
      })
    );

    return NextResponse.json({ members });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error listing members:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
