import { z } from "zod";

// ============================================================
// Tipos do recurso "Piloto de DM/Comentário" (DM Pilot).
// Saída de IA e payloads externos são validados com Zod (TS estrito).
// ============================================================

// ---- Domínio ----

export const INTENTS = ["purchase", "question", "praise", "complaint", "troll", "spam", "other"] as const;
export type Intent = (typeof INTENTS)[number];

export const ACTION_TYPES = [
  "public_reply",
  "private_reply",
  "route_dm",
  "hide",
  "like",
  "ignore",
  "human",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export type InteractionType = "comment" | "mention" | "message";

export type InteractionStatus =
  | "received"
  | "classified"
  | "actioned"
  | "held"
  | "ignored"
  | "failed";

// ---- Evento normalizado a partir do payload da Meta ----
// O webhook converte cada item do payload bruto neste formato antes de gravar.
// organization_id e channel_id NÃO vêm daqui — são resolvidos do canal pelo
// servidor (invariante #4) e carimbados na inserção.

export type NormalizedEvent = {
  providerEventId: string;
  type: InteractionType;
  externalUserId: string | null;
  externalUsername: string | null;
  postExternalId: string | null;
  text: string | null;
  raw: unknown;
};

// ---- Schema do webhook do Instagram (Graph API) ----
// Modelado conforme o formato canônico da Meta. Campos extras são tolerados
// (passthrough no objeto raiz) — só extraímos o que precisamos.

const igChangeValueSchema = z
  .object({
    id: z.string().optional(),
    text: z.string().optional(),
    from: z.object({ id: z.string().optional(), username: z.string().optional() }).optional(),
    media: z.object({ id: z.string().optional() }).optional(),
    // comentários trazem parent_id / media; menções trazem media_id / comment_id
    media_id: z.string().optional(),
    comment_id: z.string().optional(),
  })
  .passthrough();

const igChangeSchema = z.object({
  field: z.string(), // 'comments' | 'mentions' | ...
  value: igChangeValueSchema,
});

const igMessagingSchema = z
  .object({
    sender: z.object({ id: z.string() }),
    recipient: z.object({ id: z.string() }).optional(),
    timestamp: z.number().optional(),
    message: z
      .object({
        mid: z.string(),
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const igEntrySchema = z
  .object({
    id: z.string(), // IG account id (o canal que recebeu o evento)
    time: z.number().optional(),
    changes: z.array(igChangeSchema).optional(),
    messaging: z.array(igMessagingSchema).optional(),
  })
  .passthrough();

export const igWebhookSchema = z.object({
  object: z.string(), // 'instagram'
  entry: z.array(igEntrySchema),
});

export type IgWebhookPayload = z.infer<typeof igWebhookSchema>;
export type IgEntry = z.infer<typeof igEntrySchema>;
