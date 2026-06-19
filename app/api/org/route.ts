import {
  getSupabaseServerClient,
  getSupabaseAdminClient,
  getActiveOrg,
} from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/org — lista as organizações do usuário (com papel) + a org ativa.
export async function GET() {
  try {
    // getActiveOrg garante org pessoal e resolve a ativa (cookie + validação).
    const { supabase, userId, orgId: activeOrgId } = await getActiveOrg();

    // RLS members_select limita às memberships do próprio usuário.
    const { data, error } = await supabase
      .from("organization_members")
      .select("role, organizations(id, name, type, created_at)")
      .eq("user_id", userId);

    if (error) {
      console.error("Error listing orgs:", error);
      return NextResponse.json({ error: "Failed to list organizations" }, { status: 500 });
    }

    const orgs = (data ?? []).map((m) => {
      const org = m.organizations as unknown as {
        id: string; name: string; type: string; created_at: string;
      };
      return { id: org.id, name: org.name, type: org.type, role: m.role };
    });

    return NextResponse.json({ organizations: orgs, activeOrgId });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error listing orgs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/org — cria uma organização "team" (B2B) e torna o criador owner.
export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSupabaseServerClient();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name } = await request.json();
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Usa admin client para criar org + membership atomicamente do lado do servidor.
    const admin = getSupabaseAdminClient();

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: name.trim(), type: "team", created_by: userId })
      .select("id, name, type")
      .single();
    if (orgErr || !org) {
      console.error("Error creating org:", orgErr);
      return NextResponse.json({ error: "Failed to create organization" }, { status: 500 });
    }

    const { error: memErr } = await admin
      .from("organization_members")
      .insert({ org_id: org.id, user_id: userId, role: "owner" });
    if (memErr) {
      console.error("Error creating membership:", memErr);
      return NextResponse.json({ error: "Failed to create membership" }, { status: 500 });
    }

    return NextResponse.json(
      { organization: { id: org.id, name: org.name, type: org.type, role: "owner" } },
      { status: 201 }
    );
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    console.error("Error creating org:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
