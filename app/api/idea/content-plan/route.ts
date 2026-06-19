import { AI_MODEL, getOpenAI } from "@/lib/ai";
import { getActiveOrg } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { enforceLimit, planLimitResponse } from "@/lib/plan-limits";
import { NextRequest, NextResponse } from "next/server";

// POST /api/idea/content-plan — gera um plano de conteúdo (N ideias) via IA
// e insere todas no Kanban (grupo "Unassigned") de uma vez.
// Body: { businessType, targetAudience, count? }
export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, userId } = await getActiveOrg();
    await enforceLimit(supabase, orgId, "ai");

    const { businessType, targetAudience, count = 7 } = await request.json();
    if (!businessType || !targetAudience) {
      return NextResponse.json(
        { error: "Informe o tipo de negócio e o público-alvo" },
        { status: 400 }
      );
    }
    const n = Math.min(Math.max(Number(count) || 7, 1), 14);

    const result = await getOpenAI().chat.completions.create({
      model: AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Você é um estrategista de conteúdo para redes sociais.
Retorne apenas JSON válido com uma chave "ideas" contendo um array de ${n} itens.
Cada item deve ter "title" e "description".
As ideias devem ser variadas (educativo, bastidores, prova social, promocional, engajamento).
Títulos curtos e chamativos. Descrições práticas (1-2 frases).
Escreva em português. Não use markdown (**, *, #, crases). Texto puro.`,
        },
        {
          role: "user",
          content: `Tipo de negócio: ${businessType}. Público-alvo: ${targetAudience}. Gere ${n} ideias para um plano de conteúdo.`,
        },
      ],
    });

    const text = result.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as {
      ideas?: { title: string; description: string }[];
    };
    const ideas = (parsed.ideas ?? []).slice(0, n);
    if (ideas.length === 0) {
      return NextResponse.json({ error: "A IA não retornou ideias" }, { status: 502 });
    }

    // Grupo padrão "Unassigned" (lookup global).
    const { data: group } = await supabase
      .from("idea_groups")
      .select("id")
      .eq("name", "Unassigned")
      .single();

    if (!group) {
      return NextResponse.json({ error: "Grupo de ideias não encontrado" }, { status: 500 });
    }

    const payload = ideas.map((idea, i) => ({
      org_id: orgId,
      user_id: userId,
      group_id: group.id,
      title: idea.title,
      description: idea.description,
      images: [],
      sort_order: i,
    }));

    const { data, error } = await supabase.from("ideas").insert(payload).select();
    if (error) {
      console.error("Error inserting content plan:", error);
      return NextResponse.json({ error: "Falha ao salvar as ideias" }, { status: 500 });
    }

    return NextResponse.json({ created: data?.length ?? 0, ideas: data }, { status: 201 });
  } catch (error) {
    const authErr = authErrorResponse(error);
    if (authErr) return authErr;
    const planErr = planLimitResponse(error);
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 403 });
    console.error("Error generating content plan:", error);
    return NextResponse.json({ error: "Falha ao gerar o plano de conteúdo" }, { status: 500 });
  }
}
