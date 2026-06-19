import { requirePlatformAdmin, getSupabaseAdminClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/users/[id] — detalhe de um usuário (perfil + orgs + admin?).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: u } = await admin.auth.admin.getUserById(id);
    if (!u?.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: memberships } = await admin
      .from("organization_members")
      .select("role, organizations(id, name, type)")
      .eq("user_id", id);

    const orgs = (memberships ?? []).map((m) => {
      const org = m.organizations as unknown as { id: string; name: string; type: string };
      return { id: org.id, name: org.name, type: org.type, role: m.role };
    });

    const { data: adminRow } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", id)
      .maybeSingle();

    return NextResponse.json({
      user: {
        id: u.user.id,
        email: u.user.email,
        createdAt: u.user.created_at,
        lastSignInAt: u.user.last_sign_in_at ?? null,
        confirmed: !!u.user.email_confirmed_at,
        isPlatformAdmin: !!adminRow,
      },
      orgs,
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/admin/users/[id] — promover/rebaixar super-admin OU suspender/reativar.
// Body: { isPlatformAdmin?: boolean, banned?: boolean }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: actorId } = await requirePlatformAdmin();
    const { id } = await params;
    const { isPlatformAdmin, banned } = await request.json();
    const admin = getSupabaseAdminClient();

    // Suspender / reativar usuário (ban nativo do Supabase Auth).
    if (typeof banned === "boolean") {
      if (id === actorId) {
        return NextResponse.json(
          { error: "Você não pode suspender a si mesmo" },
          { status: 409 }
        );
      }
      // ban_duration aceita "none" para reativar, ou uma duração (ex.: "876000h" ~ 100 anos).
      await admin.auth.admin.updateUserById(id, {
        ban_duration: banned ? "876000h" : "none",
      });
      await logAudit({
        actorId, action: banned ? "user.suspend" : "user.reactivate",
        targetType: "user", targetId: id,
      });
      return NextResponse.json({ success: true });
    }

    if (typeof isPlatformAdmin === "boolean") {
      if (isPlatformAdmin) {
        await admin.from("platform_admins").upsert({ user_id: id }, { onConflict: "user_id" });
        await logAudit({ actorId, action: "user.promote", targetType: "user", targetId: id });
      } else {
        if (id === actorId) {
          return NextResponse.json(
            { error: "Você não pode remover seu próprio acesso de admin" },
            { status: 409 }
          );
        }
        await admin.from("platform_admins").delete().eq("user_id", id);
        await logAudit({ actorId, action: "user.demote", targetType: "user", targetId: id });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/admin/users/[id] — excluir usuário (e seus dados via cascade das orgs).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: actorId } = await requirePlatformAdmin();
    const { id } = await params;

    if (id === actorId) {
      return NextResponse.json(
        { error: "Você não pode excluir a si mesmo" },
        { status: 409 }
      );
    }

    const admin = getSupabaseAdminClient();

    // Remove orgs pessoais das quais o usuário é o único dono (cascade limpa dados).
    const { data: memberships } = await admin
      .from("organization_members")
      .select("org_id, organizations(type)")
      .eq("user_id", id);

    for (const m of memberships ?? []) {
      const org = m.organizations as unknown as { type: string };
      if (org?.type === "personal") {
        await admin.from("organizations").delete().eq("id", m.org_id);
      }
    }

    await admin.from("platform_admins").delete().eq("user_id", id);
    await logAudit({ actorId, action: "user.delete", targetType: "user", targetId: id });
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
