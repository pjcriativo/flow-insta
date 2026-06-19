import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

const ROLES = ["admin", "member"] as const;

// Impede que a org fique sem nenhum owner: retorna true se o alvo é o ÚNICO
// owner da org (e portanto não pode ser rebaixado nem removido).
async function isLastOwner(
  supabase: SupabaseClient,
  orgId: string,
  targetUserId: string
): Promise<boolean> {
  const { data: owners } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "owner");
  const ownerIds = (owners ?? []).map((o) => o.user_id);
  return ownerIds.length <= 1 && ownerIds.includes(targetUserId);
}

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

    // Não rebaixar o último owner (deixaria a org sem governança).
    if (await isLastOwner(supabase, orgId, targetUserId)) {
      return NextResponse.json(
        { error: "Não é possível rebaixar o único owner da organização" },
        { status: 409 }
      );
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

    // Não remover o último owner (deixaria a org sem governança).
    if (await isLastOwner(supabase, orgId, targetUserId)) {
      return NextResponse.json(
        { error: "Não é possível remover o único owner da organização" },
        { status: 409 }
      );
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
