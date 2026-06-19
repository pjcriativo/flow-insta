import { getSupabaseServerClient, ACTIVE_ORG_COOKIE } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// POST /api/org/switch — define a organização ativa (cookie), validando membership.
export async function POST(request: NextRequest) {
  try {
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orgId } = await request.json();
    if (!orgId || typeof orgId !== "string") {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    // Confirma que o usuário é membro da org pedida (nunca confia no cliente).
    const { data: membership } = await supabase
      .from("organization_members")
      .select("org_id")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true, orgId });
    response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 ano
    });
    return response;
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error switching org:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
