import { getSupabaseServerClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const ROLES = ["admin", "member"] as const;

// GET /api/org/[id]/invitations — lista convites pendentes (owner/admin via RLS).
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

    const { data, error } = await supabase
      .from("invitations")
      .select("id, email, role, status, expires_at, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to list invitations" }, { status: 500 });
    }
    return NextResponse.json({ invitations: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/org/[id]/invitations — cria um convite (owner/admin via RLS).
// Retorna o link de aceite (o envio de e-mail é opcional/futuro).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orgId } = await params;
    const { supabase, userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { email, role = "member" } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    // Limite de membros do plano (membros atuais + convites contam como +1).
    await enforceLimit(supabase, orgId, "members");

    const token = randomBytes(32).toString("base64url");

    // RLS invitations_insert exige owner/admin da org.
    const { data, error } = await supabase
      .from("invitations")
      .insert({
        org_id: orgId,
        email: email.toLowerCase().trim(),
        role,
        token,
        invited_by: userId,
      })
      .select("id, email, role, token")
      .single();

    if (error) {
      // Conflito de convite pendente duplicado
      if (error.code === "23505") {
        return NextResponse.json({ error: "Já existe um convite pendente para este e-mail" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const inviteUrl = `${appUrl}/invite/${data.token}`;

    return NextResponse.json({ invitation: data, inviteUrl }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
