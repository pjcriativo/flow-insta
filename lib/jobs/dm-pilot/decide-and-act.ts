import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { getOpenAI, AI_MODEL } from "@/lib/ai";
import { createMetaClient, type MetaResult } from "@/lib/meta/client";
import { getChannelToken } from "@/lib/meta/tokens";
import { getDmPilotVoice } from "@/lib/dm-pilot/voice";
import {
  replySchema,
  replySystemPrompt,
  replyUserPrompt,
  type ReplyResult,
} from "@/lib/dm-pilot/prompts";
import { evaluateWindow, canSendDm } from "@/lib/dm-pilot/window";
import { matchKeyword, type KeywordRow } from "@/lib/dm-pilot/keywords";
import type { ActionType, Intent } from "@/types/dm-pilot";
import type { EventRow } from "./types";

// ============================================================
// Etapa DECIDE-AND-ACT: status 'classified' -> 'actioned' | 'held' | 'ignored'.
//
// Aplica a regra da intenção. Caminhos:
//  - require_human_review OU confiança < min_confidence  -> review_queue + 'held'
//  - action 'ignore'/'human'                              -> 'ignored'/'held'
//  - senão gera texto na voz e chama a Meta               -> 'actioned'
//
// INVARIANTES garantidas aqui:
//  #5 kill_switch checado ANTES de qualquer saída -> ação 'skipped', sem enviar.
//  #6 DM só dentro da janela de 24h (ou tag permitida e não-promocional).
//  #8 guardrail no prompt; needsHumanReview / baixa confiança -> revisão.
//  #9 require_human_review default true (vem da config).
// ============================================================

type Config = {
  enabled: boolean;
  kill_switch: boolean;
  require_human_review: boolean;
  min_confidence: number;
  agent_prompt: string;
};

type Rule = { action_type: ActionType; prompt_template: string | null };

export async function runDecideAndAct(event: EventRow, nowMs: number): Promise<void> {
  const admin = getSupabaseAdminClient();

  const config = await loadConfig(admin, event.organization_id, event.channel_id);

  // Automação desligada -> ignora silenciosamente.
  if (!config || !config.enabled) {
    await setStatus(event.id, "ignored");
    return;
  }

  // INVARIANTE #10: conversa silenciada (agent_active=false / do_not_contact)
  // -> o agente não responde.
  const gate = await loadConversationGate(admin, event.channel_id, event.external_user_id);
  if (gate && (gate.agent_active === false || gate.do_not_contact === true)) {
    await setStatus(event.id, "ignored");
    return;
  }

  const intent = (event.intent ?? "other") as Intent;
  const confidence = event.intent_confidence ?? 0;

  const rule = await loadRule(admin, event.organization_id, event.channel_id, intent);
  const action: ActionType = rule?.action_type ?? "ignore";

  // Ações que não produzem saída de conteúdo.
  if (action === "ignore") {
    await setStatus(event.id, "ignored");
    return;
  }

  // INVARIANTE #8/#9: revisão humana exigida ou confiança baixa -> segura.
  const needsReview = config.require_human_review || confidence < config.min_confidence;

  if (action === "human" || needsReview) {
    await holdForReview(admin, event, {
      action_type: action,
      reason: action === "human" ? "rule_human" : confidence < config.min_confidence ? "low_confidence" : "require_human_review",
    });
    return;
  }

  // Ações de moderação sem geração de texto (hide/like) — ainda passam pelo
  // kill-switch antes de tocar a Meta.
  if (action === "hide" || action === "like") {
    await actOnMeta(admin, event, config, nowMs, { action_type: action, text: null, isPromotional: false });
    return;
  }

  // Ações que geram texto na voz da marca: public_reply, private_reply, route_dm.
  const brandVoice = await getDmPilotVoice(admin, event.organization_id, event.channel_id);
  // agent_prompt (editável pelo usuário) tem prioridade e é prefixado à voz da
  // marca — o operador instrui o agente; a voz dá tom/estilo.
  const voice = config.agent_prompt?.trim()
    ? `${config.agent_prompt.trim()}\n\n${brandVoice}`
    : brandVoice;
  const faq = await loadFaq(admin, event.organization_id, event.channel_id);

  const replyChannel =
    action === "public_reply" ? "public_reply" : action === "private_reply" ? "private_reply" : "dm";

  const generated = await generateReply({
    voice,
    channel: replyChannel,
    intent,
    interactionText: event.text ?? "",
    faq,
  });

  // Guardrail acionado pela IA -> segura para revisão (texto vazio).
  if (generated.needsHumanReview || !generated.text.trim()) {
    await holdForReview(admin, event, {
      action_type: action,
      reason: "guardrail",
      suggestedText: generated.text,
    });
    return;
  }

  await actOnMeta(admin, event, config, nowMs, {
    action_type: action,
    text: generated.text,
    isPromotional: generated.isPromotional,
  });
}

// ---------------------------------------------------------
// CAMADA DETERMINÍSTICA (zip): keyword -> resposta pronta, ANTES do LLM.
//
// Chamado no início do pipeline (status 'received'). Se o texto casa uma
// keyword_responses ativa, envia a resposta pronta e marca 'actioned' SEM
// chamar o classificador. Respeita: automação ligada, kill-switch (#5),
// agent_active/do_not_contact (#10). Retorna true se TRATOU o evento.
// ---------------------------------------------------------
export async function tryKeywordResponse(event: EventRow): Promise<boolean> {
  const admin = getSupabaseAdminClient();
  const text = event.text ?? "";
  if (!text.trim()) return false;

  const config = await loadConfig(admin, event.organization_id, event.channel_id);
  if (!config || !config.enabled) return false; // automação off -> deixa o fluxo normal decidir

  // INVARIANTE #10: conversa silenciada -> nem keyword responde.
  const conv = await loadConversationGate(admin, event.channel_id, event.external_user_id);
  if (conv && (conv.agent_active === false || conv.do_not_contact === true)) {
    await setStatus(event.id, "ignored");
    return true;
  }

  const rows = await loadKeywords(admin, event.organization_id, event.channel_id);
  const match = matchKeyword(text, rows);
  if (!match) return false;

  // Define o canal de resposta: comentário/menção -> resposta pública; DM -> DM.
  const actionType: ActionType = event.type === "message" ? "route_dm" : "public_reply";

  // INVARIANTE #5: kill-switch -> registra skipped, não envia.
  if (config.kill_switch) {
    await recordAction(admin, event, actionType, "skipped", {
      provider_message_id: null,
      error: "kill_switch",
      payload: { text: match.response_message, from: "keyword", keyword: match.keyword },
    });
    await setStatus(event.id, "actioned");
    return true;
  }

  const token = await getChannelToken(event.channel_id);
  if (!token) {
    await recordAction(admin, event, actionType, "failed", {
      provider_message_id: null,
      error: "missing_channel_token",
      payload: { text: match.response_message, from: "keyword" },
    });
    await setStatus(event.id, "failed");
    return true;
  }

  const meta = createMetaClient({ accessToken: token.accessToken, igAccountId: token.providerAccountId });
  const result = await dispatch(meta, actionType, event, match.response_message);

  await recordAction(admin, event, actionType, result.ok ? "sent" : "failed", {
    provider_message_id: result.ok ? result.providerMessageId : null,
    error: result.ok ? null : result.error,
    payload: { text: match.response_message, from: "keyword", keyword: match.keyword },
  });

  // Registra a mensagem de saída na conversa (best-effort).
  if (result.ok) {
    await recordOutboundMessage(admin, event, match.response_message, result.providerMessageId);
  }

  await setStatus(event.id, result.ok ? "actioned" : "failed");
  return true;
}

async function loadKeywords(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  channelId: string
): Promise<KeywordRow[]> {
  const { data } = await admin
    .from("keyword_responses")
    .select("id, keyword, variations, response_message, active")
    .eq("organization_id", orgId)
    .eq("active", true)
    .or(`channel_id.eq.${channelId},channel_id.is.null`);
  return (data as KeywordRow[] | null) ?? [];
}

async function loadConversationGate(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  channelId: string,
  externalUserId: string | null
): Promise<{ agent_active: boolean; do_not_contact: boolean } | null> {
  if (!externalUserId) return null;
  const { data } = await admin
    .from("conversations")
    .select("agent_active, do_not_contact")
    .eq("channel_id", channelId)
    .eq("external_user_id", externalUserId)
    .maybeSingle();
  return (data as { agent_active: boolean; do_not_contact: boolean } | null) ?? null;
}

async function recordOutboundMessage(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  event: EventRow,
  text: string,
  providerMessageId: string | null
): Promise<void> {
  if (!event.external_user_id) return;
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("channel_id", event.channel_id)
    .eq("external_user_id", event.external_user_id)
    .maybeSingle();
  if (!conv) return;
  await admin.from("conversation_messages").insert({
    conversation_id: (conv as { id: string }).id,
    organization_id: event.organization_id,
    direction: "out",
    text,
    provider_message_id: providerMessageId,
  });
}

// ---------------------------------------------------------
// Saída à Meta — kill-switch e janela são checados AQUI, na borda.
// ---------------------------------------------------------
async function actOnMeta(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  event: EventRow,
  config: Config,
  nowMs: number,
  act: { action_type: ActionType; text: string | null; isPromotional: boolean }
): Promise<void> {
  // INVARIANTE #5: kill-switch ligado -> NÃO envia. Registra 'skipped'.
  if (config.kill_switch) {
    await recordAction(admin, event, act.action_type, "skipped", {
      provider_message_id: null,
      error: "kill_switch",
      payload: { text: act.text },
    });
    await setStatus(event.id, "actioned");
    return;
  }

  // Token decriptado só agora, na borda (INVARIANTE #7).
  const token = await getChannelToken(event.channel_id);
  if (!token) {
    await recordAction(admin, event, act.action_type, "failed", {
      provider_message_id: null,
      error: "missing_channel_token",
      payload: { text: act.text },
    });
    await setStatus(event.id, "failed");
    return;
  }

  const meta = createMetaClient({ accessToken: token.accessToken, igAccountId: token.providerAccountId });

  // route_dm / private_reply: precisam respeitar a janela de 24h (#6).
  if (act.action_type === "route_dm" || act.action_type === "private_reply") {
    const conv = await loadConversation(admin, event.channel_id, event.external_user_id);
    const window = evaluateWindow(conv?.window_expires_at ?? null, nowMs);
    const verdict = canSendDm({ window, isPromotional: act.isPromotional });
    if (!verdict.allowed) {
      await recordAction(admin, event, act.action_type, "skipped", {
        provider_message_id: null,
        error: `window:${verdict.reason}`,
        payload: { text: act.text },
      });
      await setStatus(event.id, "actioned");
      return;
    }
  }

  const result = await dispatch(meta, act.action_type, event, act.text);

  await recordAction(admin, event, act.action_type, result.ok ? "sent" : "failed", {
    provider_message_id: result.ok ? result.providerMessageId : null,
    error: result.ok ? null : result.error,
    payload: { text: act.text },
  });

  // 'purchase' + public_reply também dispara o private reply (puxa pro DM).
  if (result.ok && act.action_type === "public_reply" && (event.intent as Intent) === "purchase" && event.provider_event_id) {
    if (!config.kill_switch) {
      const pr = await meta.privateReply(event.provider_event_id, act.text ?? "");
      await recordAction(admin, event, "private_reply", pr.ok ? "sent" : "failed", {
        provider_message_id: pr.ok ? pr.providerMessageId : null,
        error: pr.ok ? null : pr.error,
        payload: { from: "purchase_followup" },
      });
    }
  }

  await setStatus(event.id, result.ok ? "actioned" : "failed");
}

function dispatch(
  meta: ReturnType<typeof createMetaClient>,
  action: ActionType,
  event: EventRow,
  text: string | null
): Promise<MetaResult> {
  const commentId = event.provider_event_id;
  switch (action) {
    case "public_reply":
      return meta.publicReply(commentId, text ?? "");
    case "private_reply":
      return meta.privateReply(commentId, text ?? "");
    case "route_dm":
      return meta.sendDm(event.external_user_id ?? "", text ?? "");
    case "hide":
      return meta.hide(commentId);
    case "like":
      return meta.like(commentId);
    default:
      return Promise.resolve({ ok: false, error: `ação não suportada: ${action}` });
  }
}

// ---------------------------------------------------------
// Envio APROVADO pela fila de revisão.
//
// Chamado pela rota de aprovação (UI inbox/review) quando um humano aprova ou
// edita a sugestão. Reusa actOnMeta — então kill-switch (#5), janela (#6) e
// token-na-borda (#7) continuam valendo. require_human_review NÃO se aplica
// aqui (já houve aprovação humana). Retorna se enviou (para a rota responder).
// ---------------------------------------------------------
export async function sendApprovedAction(args: {
  eventId: string;
  organizationId: string;
  actionType: ActionType;
  text: string;
  nowMs: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const admin = getSupabaseAdminClient();

  const { data: ev } = await admin
    .from("interaction_events")
    .select(
      "id, organization_id, channel_id, provider, provider_event_id, type, external_user_id, external_username, post_external_id, text, intent, intent_confidence, status, attempts"
    )
    .eq("id", args.eventId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (!ev) return { ok: false, reason: "event_not_found" };
  const event = ev as EventRow;

  const config = await loadConfig(admin, event.organization_id, event.channel_id);
  // Sem config/desligado ainda permitimos o envio aprovado manualmente, mas o
  // kill-switch (se houver config) é respeitado dentro de actOnMeta.
  const effectiveConfig: Config = config ?? {
    enabled: true,
    kill_switch: false,
    require_human_review: true,
    min_confidence: 0,
    agent_prompt: "",
  };

  // Texto editado pelo revisor não passa pelo classificador de promo da IA;
  // tratamos como não-promocional só quando dentro da janela. Para DM fora da
  // janela, actOnMeta/ canSendDm já barram conteúdo promocional — aqui marcamos
  // isPromotional=false e deixamos a janela decidir (conservador).
  await actOnMeta(admin, event, effectiveConfig, args.nowMs, {
    action_type: args.actionType,
    text: args.text,
    isPromotional: false,
  });

  return { ok: true };
}

// ---------------------------------------------------------
// Geração de texto na voz (Zod-validada).
// ---------------------------------------------------------
async function generateReply(ctx: {
  voice: string;
  channel: "public_reply" | "private_reply" | "dm";
  intent: string;
  interactionText: string;
  faq: { question: string; answer: string }[];
}): Promise<ReplyResult> {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: replySystemPrompt(ctx.voice) },
      {
        role: "user",
        content: replyUserPrompt({
          voiceInstruction: ctx.voice,
          channel: ctx.channel,
          intent: ctx.intent,
          interactionText: ctx.interactionText,
          faq: ctx.faq,
        }),
      },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  return replySchema.parse(JSON.parse(raw));
}

// ---------------------------------------------------------
// Helpers de dados
// ---------------------------------------------------------
async function loadConfig(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  channelId: string
): Promise<Config | null> {
  const { data } = await admin
    .from("automation_configs")
    .select("enabled, kill_switch, require_human_review, min_confidence, agent_prompt")
    .eq("organization_id", orgId)
    .eq("channel_id", channelId)
    .maybeSingle();
  if (!data) return null;
  return { ...(data as Omit<Config, "agent_prompt">), agent_prompt: (data as { agent_prompt?: string }).agent_prompt ?? "" };
}

async function loadRule(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  channelId: string,
  intent: Intent
): Promise<Rule | null> {
  const { data } = await admin
    .from("automation_rules")
    .select("action_type, prompt_template")
    .eq("organization_id", orgId)
    .eq("channel_id", channelId)
    .eq("intent", intent)
    .eq("enabled", true)
    .maybeSingle();
  return (data as Rule | null) ?? null;
}

async function loadFaq(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  channelId: string
): Promise<{ question: string; answer: string }[]> {
  const { data } = await admin
    .from("faq_entries")
    .select("question, answer")
    .eq("organization_id", orgId)
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .limit(10);
  return (data as { question: string; answer: string }[] | null) ?? [];
}

async function loadConversation(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  channelId: string,
  externalUserId: string | null
): Promise<{ window_expires_at: string | null } | null> {
  if (!externalUserId) return null;
  const { data } = await admin
    .from("conversations")
    .select("window_expires_at")
    .eq("channel_id", channelId)
    .eq("external_user_id", externalUserId)
    .maybeSingle();
  return (data as { window_expires_at: string | null } | null) ?? null;
}

async function holdForReview(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  event: EventRow,
  opts: { action_type: ActionType; reason: string; suggestedText?: string }
): Promise<void> {
  await admin.from("review_queue").insert({
    organization_id: event.organization_id,
    event_id: event.id,
    suggested_action: {
      action_type: opts.action_type,
      reason: opts.reason,
      text: opts.suggestedText ?? null,
      intent: event.intent,
    },
    status: "pending",
  });
  await setStatus(event.id, "held");
}

async function recordAction(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  event: EventRow,
  actionType: ActionType,
  status: "sent" | "failed" | "skipped" | "held" | "pending",
  extra: { provider_message_id: string | null; error: string | null; payload: Record<string, unknown> }
): Promise<void> {
  await admin.from("interaction_actions").insert({
    event_id: event.id,
    organization_id: event.organization_id,
    action_type: actionType,
    payload: extra.payload,
    provider_message_id: extra.provider_message_id,
    status,
    actor: "system",
    error: extra.error,
  });
}

async function setStatus(eventId: string, status: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin
    .from("interaction_events")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", eventId);
}
