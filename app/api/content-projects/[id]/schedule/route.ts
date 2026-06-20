import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "flow-insta";

// =========================================================
// POST /api/content-projects/:id/schedule
// "Enviar pro calendário": de um content_project COMPLETO (imagens geradas),
// cria UM scheduled_posts com as mídias ordenadas (slides) + caption + canal +
// scheduled_at. NÃO cria tabela paralela — reusa scheduled_posts e o scheduler.
//
// scheduled_at deve chegar em UTC (ISO). A UI converte do fuso da org -> UTC.
// status 'queue' = o tick publica no horário. 'draft' = só agenda sem publicar.
// =========================================================

const ScheduleSchema = z.object({
  channel_type_id: z.string().uuid(),
  scheduled_at: z.string().datetime({ message: "scheduled_at deve ser ISO UTC" }),
  status: z.enum(["queue", "draft"]).optional().default("queue"),
  // Caption opcional: se ausente, monta a partir do slide 1.
  caption: z.string().max(2200).nullable().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, orgId, userId } = await getActiveOrg();
    const parsed = ScheduleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }
    const { channel_type_id, scheduled_at, status, caption } = parsed.data;

    // Projeto + slides (precisam estar com imagem gerada).
    const { data: project } = await supabase
      .from("content_projects")
      .select("id, status")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });

    const { data: slides } = await supabase
      .from("content_slides")
      .select("slide_number, headline, body, image_path, generation_status")
      .eq("project_id", id)
      .eq("organization_id", orgId)
      .order("slide_number", { ascending: true });

    const ready = (slides ?? []).filter((s) => s.image_path && s.generation_status === "completed");
    if (ready.length === 0) {
      return NextResponse.json({ error: "Gere as imagens antes de agendar" }, { status: 409 });
    }

    // Mídias ordenadas (carrossel mantém a ordem dos slides). Bucket público.
    const images = ready.map((s) => ({
      key: s.image_path as string,
      url: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(s.image_path as string).data.publicUrl,
    }));

    // Caption: a informada, ou monta do slide 1 (headline + body).
    const first = ready[0];
    const content =
      caption ??
      [first.headline, first.body].filter((t) => t && t.trim()).join("\n\n") ??
      "";

    // Resolve o canal ativo/conectado do tipo escolhido (mesma regra de /api/post).
    const { data: channel } = await supabase
      .from("user_channels")
      .select("id")
      .eq("org_id", orgId)
      .eq("channel_type_id", channel_type_id)
      .eq("is_active", true)
      .eq("is_connected", true)
      .maybeSingle();
    if (!channel) {
      return NextResponse.json({ error: "Nenhum canal ativo para esse tipo" }, { status: 404 });
    }

    await enforceLimit(supabase, orgId, "posts", 1);

    const { data: post, error: insErr } = await supabase
      .from("scheduled_posts")
      .insert({
        org_id: orgId,
        user_id: userId,
        user_channel_id: channel.id,
        content,
        images,
        scheduled_at,
        status,
      })
      .select()
      .single();

    if (insErr) {
      console.error("[content schedule] insert", insErr.message);
      return NextResponse.json({ error: "Falha ao agendar" }, { status: 500 });
    }
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("[content schedule] POST", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
