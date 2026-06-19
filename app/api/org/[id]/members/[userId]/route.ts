import { getSupabaseServerClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

const ROLES = ["admin", "member"] as const;

// PATCH /api/org/[id]/members/[userId] — muda o papel de um membro.
// RLS members_update exige que o solicitante seja owner/admin da org.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: orgId, userId: targetUserId } = await params;
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role } = await request.json();
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { error } = await supabase
      .from("organization_members")
      .update({ role })
      .eq("org_id", orgId)
      .eq("user_id", targetUserId);

    if (error) {
      return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/org/[id]/members/[userId] — remove um membro (owner/admin)
// ou o próprio usuário sai. RLS members_delete cobre os dois casos.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: orgId, userId: targetUserId } = await params;
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("organization_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", targetUserId);

    if (error) {
      return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
