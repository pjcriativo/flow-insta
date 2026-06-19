import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

// GET /api/atomization/[jobId] — detalhe do job + clips (com assets e post draft).
// RLS garante que só membros da org do job conseguem ler (org ativa = a do job).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const { supabase, orgId } = await getActiveOrg();

    const { data: job, error: jobErr } = await supabase
      .from("atomization_jobs")
      .select(
        "id, source_url, youtube_video_id, title, channel_title, status, clip_count, settings, error, created_at"
      )
      .eq("id", jobId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (jobErr) {
      return NextResponse.json({ error: "Falha ao carregar" }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    // Clips do job, ordenados. Para cada clip, traz seus assets (com post_id).
    const { data: clips } = await supabase
      .from("atomization_clips")
      .select(
        `id, clip_index, start_seconds, end_seconds, hook_text, rationale,
         virality_score, status, video_asset_path, thumbnail_path,
         assets:atomization_assets ( id, asset_type, payload, post_id )`
      )
      .eq("job_id", jobId)
      .eq("organization_id", orgId)
      .order("clip_index", { ascending: true });

    // Conteúdo atual dos posts draft (para editar a legenda do reel).
    const postIds = (clips ?? [])
      .flatMap((c) => (c.assets ?? []).map((a: { post_id: string | null }) => a.post_id))
      .filter((id): id is string => !!id);

    let postsById: Record<string, { id: string; content: string; status: string }> = {};
    if (postIds.length > 0) {
      const { data: posts } = await supabase
        .from("scheduled_posts")
        .select("id, content, status")
        .in("id", postIds)
        .eq("org_id", orgId);
      postsById = Object.fromEntries((posts ?? []).map((p) => [p.id, p]));
    }

    return NextResponse.json({ job, clips: clips ?? [], postsById });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
