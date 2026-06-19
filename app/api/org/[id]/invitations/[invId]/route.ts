import { getSupabaseServerClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// DELETE /api/org/[id]/invitations/[invId] — revoga um convite (owner/admin via RLS).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; invId: string }> }
) {
  try {
    const { id: orgId, invId } = await params;
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("invitations")
      .update({ status: "revoked" })
      .eq("id", invId)
      .eq("org_id", orgId);

    if (error) {
      return NextResponse.json({ error: "Failed to revoke invitation" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
