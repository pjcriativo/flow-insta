import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import {
  expectedTxtRecord,
  verifyDomainTxt,
  sanitizeDomain,
} from "@/lib/branding/domain";
import { NextResponse } from "next/server";

// GET /api/branding/verify-domain — retorna o registro TXT esperado.
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data } = await supabase
      .from("workspace_branding")
      .select("custom_domain, domain_verified")
      .eq("organization_id", orgId)
      .maybeSingle();

    const domain = data?.custom_domain ?? null;
    return NextResponse.json({
      domain,
      verified: data?.domain_verified ?? false,
      txtRecord: domain ? expectedTxtRecord(orgId, domain) : null,
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

// POST /api/branding/verify-domain — checa o TXT no DNS e marca verified.
export async function POST() {
  try {
    const { supabase, orgId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data } = await supabase
      .from("workspace_branding")
      .select("custom_domain")
      .eq("organization_id", orgId)
      .maybeSingle();

    const domain = data?.custom_domain ? sanitizeDomain(data.custom_domain) : null;
    if (!domain) {
      return NextResponse.json({ error: "Defina um domínio primeiro" }, { status: 400 });
    }

    const ok = await verifyDomainTxt(orgId, domain);
    if (ok) {
      await supabase
        .from("workspace_branding")
        .update({ domain_verified: true })
        .eq("organization_id", orgId);
    }

    return NextResponse.json({
      verified: ok,
      txtRecord: expectedTxtRecord(orgId, domain),
    });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
