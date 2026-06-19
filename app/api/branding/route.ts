import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { sanitizeDomain } from "@/lib/branding/domain";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// GET /api/branding — branding da org ativa (cria default vazio se não existir).
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();

    const { data } = await supabase
      .from("workspace_branding")
      .select("logo_path, primary_color, accent_color, custom_domain, domain_verified, email_from_name")
      .eq("organization_id", orgId)
      .maybeSingle();

    return NextResponse.json({
      branding:
        data ?? {
          logo_path: null,
          primary_color: "#6366f1",
          accent_color: "#06b6d4",
          custom_domain: null,
          domain_verified: false,
          email_from_name: null,
        },
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");

const patchSchema = z.object({
  logo_path: z.string().max(500).nullable().optional(),
  primary_color: hexColor.optional(),
  accent_color: hexColor.optional(),
  custom_domain: z.string().max(255).nullable().optional(),
  email_from_name: z.string().max(120).nullable().optional(),
});

// PATCH /api/branding — upsert do branding (owner/admin). Mudar o domínio
// reseta domain_verified para false (precisa reverificar).
export async function PATCH(request: NextRequest) {
  try {
    const { supabase, orgId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { organization_id: orgId };
    const f = parsed.data;
    if (f.logo_path !== undefined) update.logo_path = f.logo_path;
    if (f.primary_color !== undefined) update.primary_color = f.primary_color;
    if (f.accent_color !== undefined) update.accent_color = f.accent_color;
    if (f.email_from_name !== undefined) update.email_from_name = f.email_from_name;

    if (f.custom_domain !== undefined) {
      if (f.custom_domain === null || f.custom_domain === "") {
        update.custom_domain = null;
        update.domain_verified = false;
      } else {
        const clean = sanitizeDomain(f.custom_domain);
        if (!clean) {
          return NextResponse.json({ error: "Domínio inválido" }, { status: 400 });
        }
        update.custom_domain = clean;
        update.domain_verified = false; // reverificar após troca
      }
    }

    const { error } = await supabase
      .from("workspace_branding")
      .upsert(update, { onConflict: "organization_id" });

    if (error) {
      console.error("Error saving branding:", error);
      return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
