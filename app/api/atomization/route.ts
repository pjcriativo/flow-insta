import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { planLimitResponse } from "@/lib/plan-limits";
import { CreateJobInputSchema } from "@/lib/atomization/schemas";
import { fetchYouTubeMeta } from "@/lib/atomization/youtube";
import { enforceAtomizationQuota } from "@/lib/atomization/quota";
import { NextRequest, NextResponse } from "next/server";

// GET /api/atomization — lista os jobs da org ativa.
export async function GET() {
  try {
    const { supabase, orgId } = await getActiveOrg();
    const { data, error } = await supabase
      .from("atomization_jobs")
      .select("id, source_url, title, channel_title, status, clip_count, settings, error, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: "Falha ao listar" }, { status: 500 });
    }
    return NextResponse.json({ jobs: data ?? [] });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

// POST /api/atomization — cria um job de atomização.
export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, userId, role } = await getActiveOrg();
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Valida input (URL + atestado obrigatório + settings).
    const parsed = CreateJobInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    const { source_url, settings } = parsed.data;

    // Valida o vídeo do YouTube ANTES de criar o job (URL inválida/privada erra aqui).
    let meta;
    try {
      meta = await fetchYouTubeMeta(source_url);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "INVALID_URL") {
        return NextResponse.json({ error: "Informe uma URL válida do YouTube" }, { status: 400 });
      }
      if (code === "VIDEO_UNAVAILABLE") {
        return NextResponse.json(
          { error: "Vídeo indisponível, privado ou inexistente" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: "Não foi possível validar o vídeo" }, { status: 400 });
    }

    // Quota por plano (exige IA + teto mensal). Lança PlanLimitError -> 403.
    await enforceAtomizationQuota(supabase, orgId);

    // Cria o job (RLS atom_jobs_insert exige owner/admin).
    const { data: job, error: jobErr } = await supabase
      .from("atomization_jobs")
      .insert({
        organization_id: orgId,
        created_by: userId,
        source_url,
        youtube_video_id: meta.videoId,
        title: meta.title,
        channel_title: meta.channelTitle,
        duration_seconds: meta.durationSeconds,
        rights_attested: true,
        status: "queued",
        settings: {
          clip_count: settings?.clip_count ?? 5,
          auto_schedule: settings?.auto_schedule ?? false,
        },
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      console.error("Error creating atomization job:", jobErr);
      return NextResponse.json({ error: "Falha ao criar job" }, { status: 500 });
    }

    // O job foi criado com status 'queued'. O motor de jobs (/api/cron/tick,
    // disparado pelo pg_cron) o processa na próxima passada. Sem evento.
    return NextResponse.json({ id: job.id }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("Error in atomization POST:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
