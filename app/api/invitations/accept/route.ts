import {
  getSupabaseServerClient,
  getSupabaseAdminClient,
  ACTIVE_ORG_COOKIE,
} from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// POST /api/invitations/accept — aceita um convite pelo token.
// Server-side com admin client: o convidado ainda não é membro, então cria a
// membership de forma confiável após validar token, expiração e e-mail.
export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token } = await request.json();
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    // Carrega o convite e valida.
    const { data: invite, error: invErr } = await admin
      .from("invitations")
      .select("id, org_id, email, role, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (invErr || !invite) {
      return NextResponse.json({ error: "Convite inválido" }, { status: 404 });
    }
    if (invite.status !== "pending") {
      return NextResponse.json({ error: "Convite não está mais disponível" }, { status: 410 });
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await admin.from("invitations").update({ status: "expired" }).eq("id", invite.id);
      return NextResponse.json({ error: "Convite expirado" }, { status: 410 });
    }

    // Confirma que o e-mail do convite bate com o do usuário logado.
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const userEmail = authUser?.user?.email?.toLowerCase();
    if (!userEmail || userEmail !== invite.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Este convite é para outro e-mail" },
        { status: 403 }
      );
    }

    // Cria a membership (idempotente via unique(org_id,user_id)).
    const { error: memErr } = await admin
      .from("organization_members")
      .upsert(
        { org_id: invite.org_id, user_id: userId, role: invite.role },
        { onConflict: "org_id,user_id" }
      );
    if (memErr) {
      return NextResponse.json({ error: "Falha ao entrar na organização" }, { status: 500 });
    }

    await admin.from("invitations").update({ status: "accepted" }).eq("id", invite.id);

    // Define a org recém-aceita como ativa.
    const response = NextResponse.json({ success: true, orgId: invite.org_id });
    response.cookies.set(ACTIVE_ORG_COOKIE, invite.org_id, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error accepting invitation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
