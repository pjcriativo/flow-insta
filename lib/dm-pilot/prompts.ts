import { z } from "zod";
import { INTENTS, SENTIMENTS } from "@/types/dm-pilot";

// ============================================================
// Prompts e schemas de saída da IA do DM Pilot.
//
// TODA saída da IA é validada com Zod (TS estrito). O guardrail de compliance
// (INVARIANTE #8) é instruído no system prompt E reforçado no schema: a IA
// sinaliza `needsHumanReview` quando o texto exigiria claim de saúde/financeiro/
// garantia — o orquestrador então segura para revisão humana.
// ============================================================

// ---- Guardrail compartilhado ----
const GUARDRAIL = `REGRAS DE COMPLIANCE (obrigatórias):
- NUNCA faça afirmações de saúde (cura, tratamento, emagrecimento garantido, resultado clínico).
- NUNCA faça afirmações financeiras (retorno garantido, lucro certo, renda prometida).
- NUNCA prometa garantias absolutas ("100% garantido", "sem risco", "funciona para todos").
- Se a resposta adequada EXIGIR qualquer uma dessas afirmações, defina needsHumanReview=true e deixe o texto vazio.
- Não invente preços, prazos, políticas ou dados que você não recebeu no contexto.
- Seja respeitoso; nunca responda provocações (trolls) com hostilidade.`;

// ---- 1) CLASSIFY ----

export const classifySchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  sentiment: z.enum(SENTIMENTS),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

export function classifySystemPrompt(): string {
  return `Você classifica interações (comentários, menções e DMs) de Instagram de um criador/marca.
Responda APENAS com JSON no formato { "intent", "confidence", "sentiment" }.
Intents possíveis: ${INTENTS.join(", ")}.
- purchase: demonstra intenção de compra, pede preço, link, "quero", "como compro".
- question: dúvida genuína sobre produto/conteúdo.
- praise: elogio.
- complaint: reclamação/insatisfação.
- troll: provocação, hostilidade, baixo esforço para irritar.
- spam: propaganda alheia, link suspeito, repetição.
- other: não se encaixa.
confidence é sua certeza de 0 a 1. sentiment: ${SENTIMENTS.join(", ")}.`;
}

export function classifyUserPrompt(text: string, type: string): string {
  return `Tipo: ${type}\nTexto da interação:\n"""${text}"""`;
}

// ---- 2) GENERATE REPLY (resposta pública / DM na voz da marca) ----

export const replySchema = z.object({
  text: z.string(),
  needsHumanReview: z.boolean(),
  isPromotional: z.boolean(),
});
export type ReplyResult = z.infer<typeof replySchema>;

type ReplyContext = {
  voiceInstruction: string;
  channel: "public_reply" | "private_reply" | "dm";
  intent: string;
  interactionText: string;
  faq?: { question: string; answer: string }[];
  flowStep?: string | null;
};

export function replySystemPrompt(voiceInstruction: string): string {
  return `Você escreve respostas curtas de Instagram para um criador/marca, NA VOZ DELE.
${voiceInstruction}

${GUARDRAIL}

Responda APENAS com JSON { "text", "needsHumanReview", "isPromotional" }:
- text: a resposta pronta para publicar (vazio se needsHumanReview=true). Máx ~2 frases.
- needsHumanReview: true se a resposta exigiria qualquer claim proibido acima, ou se você não tem informação suficiente.
- isPromotional: true se o texto promove um produto/oferta/venda (relevante p/ a janela de 24h em DM).`;
}

export function replyUserPrompt(ctx: ReplyContext): string {
  const faqBlock =
    ctx.faq && ctx.faq.length > 0
      ? `\n\nFAQ disponível (use se relevante):\n${ctx.faq
          .map((f) => `- P: ${f.question}\n  R: ${f.answer}`)
          .join("\n")}`
      : "";
  const flowBlock = ctx.flowStep ? `\n\nPasso do funil de venda a conduzir: ${ctx.flowStep}` : "";
  return `Canal de resposta: ${ctx.channel}
Intenção detectada: ${ctx.intent}
Interação do usuário:
"""${ctx.interactionText}"""${faqBlock}${flowBlock}

Escreva a resposta na voz da marca.`;
}
