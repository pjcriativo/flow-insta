import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { getOpenAI, AI_MODEL } from "@/lib/ai";
import { createMetaClient } from "@/lib/meta/client";
import { getChannelToken } from "@/lib/meta/tokens";
import { getDmPilotVoice } from "@/lib/dm-pilot/voice";
import { replySchema, replySystemPrompt, replyUserPrompt } from "@/lib/dm-pilot/prompts";
import { evaluateWindow, canSendDm, windowExpiryFromInbound } from "@/lib/dm-pilot/window";
import type { EventRow } from "./types";

// ============================================================
// Etapa ADVANCE-FLOW: tratamento de DM de ENTRADA (type='message').
//
// Uma mensagem de entrada SEMPRE abre/renova a janela de 24h. Registramos a
// conversa + a mensagem, então (se a automação permitir) avançamos o funil
// respondendo DENTRO da janela.
//
// Diferente de decide-and-act (comentários), aqui o evento já é o próprio DM
// do usuário, então a janela acabou de abrir — o envio de resposta é seguro.
// O kill-switch continua sendo checado antes do envio (#5).
// ============================================================

type Config = {
  enabled: boolean;
  kill_switch: boolean;
  require_human_review: boolean;
};

export async function runAdvanceFlow(event: EventRow, nowMs: number): Promise<void> {
  const admin = getSupabaseAdminClient();

  const externalUserId = event.external_user_id;
  if (!externalUserId) {
    await setStatus(event.id, "ignored");
    return;
  }

  // 1) Upsert da conversa — abre/renova a janela de 24h a cada entrada (#6).
  const windowExpiresAt = windowExpiryFromInbound(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .upsert(
      {
        organization_id: event.organization_id,
        channel_id: event.channel_id,
        external_user_id: externalUserId,
        external_username: event.external_username,
        last_inbound_at: nowIso,
        window_expires_at: windowExpiresAt,
      },
      { onConflict: "channel_id,external_user_id" }
    )
    .select("id, state, do_not_contact, window_expires_at")
    .maybeSingle();

  if (convErr || !conv) {
    throw new Error(`advance-flow upsert conversa falhou: ${convErr?.message ?? "no row"}`);
  }

  // 2) Registra a mensagem de entrada.
  await admin.from("conversation_messages").insert({
    conversation_id: conv.id,
    organization_id: event.organization_id,
    direction: "in",
    text: event.text,
    intent: event.intent,
    provider_message_id: event.provider_event_id,
  });

  // do_not_contact / conversa bloqueada -> não responde.
  if (conv.do_not_contact || conv.state === "blocked" || conv.state === "handed_off") {
    await setStatus(event.id, "actioned");
    return;
  }

  const config = await loadConfig(admin, event.organization_id, event.channel_id);
  if (!config || !config.enabled) {
    await setStatus(event.id, "ignored");
    return;
  }

  // Revisão humana exigida -> não auto-responde DM (segura silenciosamente
  // como 'held'; a UI de inbox mostra a conversa para atendimento manual).
  if (config.require_human_review) {
    await setStatus(event.id, "held");
    return;
  }

  // 3) Gera a resposta na voz da marca e responde DENTRO da janela.
  const voice = await getDmPilotVoice(admin, event.organization_id, event.channel_id);
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: replySystemPrompt(voice) },
      {
        role: "user",
        content: replyUserPrompt({
          voiceInstruction: voice,
          channel: "dm",
          intent: event.intent ?? "other",
          interactionText: event.text ?? "",
        }),
      },
    ],
  });
  const generated = replySchema.parse(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));

  if (generated.needsHumanReview || !generated.text.trim()) {
    await setStatus(event.id, "held");
    return;
  }

  // INVARIANTE #5: kill-switch antes do envio.
  if (config.kill_switch) {
    await recordOutAction(admin, event, "skipped", null, "kill_switch", generated.text);
    await setStatus(event.id, "actioned");
    return;
  }

  // INVARIANTE #6: confirma a janela (acabou de abrir, mas checa por garantia).
  const window = evaluateWindow(conv.window_expires_at ?? windowExpiresAt, nowMs);
  const verdict = canSendDm({ window, isPromotional: generated.isPromotional });
  if (!verdict.allowed) {
    await recordOutAction(admin, event, "skipped", null, `window:${verdict.reason}`, generated.text);
    await setStatus(event.id, "actioned");
    return;
  }

  // INVARIANTE #7: token decriptado só na borda.
  const token = await getChannelToken(event.channel_id);
  if (!token) {
    await recordOutAction(admin, event, "failed", null, "missing_channel_token", generated.text);
    await setStatus(event.id, "failed");
    return;
  }

  const meta = createMetaClient({ accessToken: token.accessToken, igAccountId: token.providerAccountId });
  const result = await meta.sendDm(externalUserId, generated.text);

  await recordOutAction(
    admin,
    event,
    result.ok ? "sent" : "failed",
    result.ok ? result.providerMessageId : null,
    result.ok ? null : result.error,
    generated.text
  );

  if (result.ok) {
    await admin.from("conversation_messages").insert({
      conversation_id: conv.id,
      organization_id: event.organization_id,
      direction: "out",
      text: generated.text,
      provider_message_id: result.providerMessageId,
    });
  }

  await setStatus(event.id, result.ok ? "actioned" : "failed");
}

// ---------------------------------------------------------
async function loadConfig(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  channelId: string
): Promise<Config | null> {
  const { data } = await admin
    .from("automation_configs")
    .select("enabled, kill_switch, require_human_review")
    .eq("organization_id", orgId)
    .eq("channel_id", channelId)
    .maybeSingle();
  return (data as Config | null) ?? null;
}

async function recordOutAction(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  event: EventRow,
  status: "sent" | "failed" | "skipped",
  providerMessageId: string | null,
  error: string | null,
  text: string
): Promise<void> {
  await admin.from("interaction_actions").insert({
    event_id: event.id,
    organization_id: event.organization_id,
    action_type: "route_dm",
    payload: { text, from: "advance_flow" },
    provider_message_id: providerMessageId,
    status,
    actor: "system",
    error,
  });
}

async function setStatus(eventId: string, status: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin
    .from("interaction_events")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", eventId);
}
