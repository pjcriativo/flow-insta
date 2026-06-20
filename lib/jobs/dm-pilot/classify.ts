import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { getOpenAI, AI_MODEL } from "@/lib/ai";
import {
  classifySchema,
  classifySystemPrompt,
  classifyUserPrompt,
} from "@/lib/dm-pilot/prompts";
import type { EventRow } from "./types";

// ============================================================
// Etapa CLASSIFY: status 'received' -> 'classified'.
// Chama a IA, valida com Zod, grava intent/confiança/sentimento.
// Lança em erro (o runner trata retry/fail).
// ============================================================

export async function runClassify(event: EventRow): Promise<void> {
  const admin = getSupabaseAdminClient();

  const text = (event.text ?? "").trim();
  if (!text) {
    // Sem texto não há o que classificar (ex.: like, sticker). Marca 'other'
    // com confiança 0 e segue — decide-and-act decidirá ignorar.
    await admin
      .from("interaction_events")
      .update({ intent: "other", intent_confidence: 0, sentiment: "neutral", status: "classified" })
      .eq("id", event.id);
    return;
  }

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: classifySystemPrompt() },
      { role: "user", content: classifyUserPrompt(text, event.type) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  // Saída de IA SEMPRE validada com Zod — parse falho lança e vira retry.
  const parsed = classifySchema.parse(JSON.parse(raw));

  const { error } = await admin
    .from("interaction_events")
    .update({
      intent: parsed.intent,
      intent_confidence: parsed.confidence,
      sentiment: parsed.sentiment,
      status: "classified",
    })
    .eq("id", event.id);
  if (error) throw new Error(`classify update falhou: ${error.message}`);
}
