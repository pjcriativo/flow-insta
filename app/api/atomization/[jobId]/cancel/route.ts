import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { isTerminal } from "@/lib/atomization/pipeline";
import type { JobStatus } from "@/types/atomization";
import { NextRequest, NextResponse } from "next/server";

// POST /api/atomization/[jobId]/cancel — marca o job como 'canceled'.
// As funções Inngest checam isTerminal() em cada step e param sozinhas.
// Só owner/admin da org pode cancelar; job já terminal não muda.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const { supabase, orgId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: job, error: loadErr } = await supabase
      .from("atomization_jobs")
      .select("id, status")
      .eq("id", jobId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (loadErr) {
      return NextResponse.json({ error: "Falha ao carregar" }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }
    if (isTerminal(job.status as JobStatus)) {
      return NextResponse.json(
        { error: "Job já finalizado, não é possível cancelar" },
        { status: 409 }
      );
    }

    const { error: updErr } = await supabase
      .from("atomization_jobs")
      .update({ status: "canceled" })
      .eq("id", jobId)
      .eq("organization_id", orgId);

    if (updErr) {
      return NextResponse.json({ error: "Falha ao cancelar" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: "canceled" });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
