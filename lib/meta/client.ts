import { withRetry } from "./rate-limit";

// ============================================================
// Client da Graph API da Meta (Instagram).
//
// Cada método faz UMA chamada de saída e retorna MetaResult — sucesso traz
// providerMessageId; falha traz error legível. O chamador (decide-and-act)
// grava esse resultado em interaction_actions (provider_message_id OU error).
//
// INVARIANTE #7: o accessToken chega já descriptografado (de lib/meta/tokens)
// e é usado SÓ como query param na borda da chamada. NUNCA aparece em log nem
// na mensagem de erro — sanitizeError remove qualquer ocorrência do token.
// ============================================================

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string };

type MetaClientArgs = {
  /** Token em claro (borda da chamada). Nunca logar. */
  accessToken: string;
  /** IG account id (necessário p/ DM e private reply via /me/messages). */
  igAccountId?: string | null;
};

/** Remove o token (e o param access_token) de qualquer string de erro. */
function sanitizeError(message: string, accessToken: string): string {
  let out = message.split(accessToken).join("[REDACTED]");
  out = out.replace(/access_token=[^&\s"]+/gi, "access_token=[REDACTED]");
  return out;
}

async function graphFetch(
  url: string,
  init: RequestInit,
  accessToken: string,
  pickId: (json: unknown) => string | null
): Promise<MetaResult> {
  try {
    const res = await withRetry(() => fetch(url, init));
    const bodyText = await res.text();

    if (!res.ok) {
      // A resposta de erro da Graph traz { error: { message, code, ... } }.
      // Sanitiza antes de devolver — nunca vaza o token.
      const safe = sanitizeError(bodyText, accessToken).slice(0, 500);
      return { ok: false, error: `Meta ${res.status}: ${safe}` };
    }

    let json: unknown = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = null;
    }
    return { ok: true, providerMessageId: pickId(json) };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "erro de rede";
    return { ok: false, error: sanitizeError(raw, accessToken) };
  }
}

function pick(json: unknown, key: string): string | null {
  if (json && typeof json === "object" && key in json) {
    const v = (json as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

/**
 * Cliente da Meta vinculado a um canal. Os métodos espelham as ações:
 * public_reply, private_reply, route_dm/send DM, hide, like.
 */
export function createMetaClient({ accessToken, igAccountId }: MetaClientArgs) {
  const auth = `access_token=${encodeURIComponent(accessToken)}`;

  return {
    /** Resposta PÚBLICA a um comentário (cria um comentário-filho). */
    async publicReply(commentId: string, message: string): Promise<MetaResult> {
      const url = `${GRAPH_BASE}/${encodeURIComponent(commentId)}/replies?${auth}`;
      return graphFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        },
        accessToken,
        (json) => pick(json, "id")
      );
    },

    /**
     * PRIVATE REPLY a um comentário: abre um DM em resposta ao comentário.
     * Só permitido dentro da janela de resposta a comentário da Meta — o
     * chamador já checou a janela (window.ts) antes de invocar.
     */
    async privateReply(commentId: string, message: string): Promise<MetaResult> {
      if (!igAccountId) return { ok: false, error: "igAccountId ausente p/ private reply" };
      const url = `${GRAPH_BASE}/${encodeURIComponent(igAccountId)}/messages?${auth}`;
      return graphFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { comment_id: commentId },
            message: { text: message },
          }),
        },
        accessToken,
        (json) => pick(json, "message_id")
      );
    },

    /** Envia um DM a um usuário (dentro da janela de 24h — checado pelo chamador). */
    async sendDm(recipientId: string, message: string): Promise<MetaResult> {
      if (!igAccountId) return { ok: false, error: "igAccountId ausente p/ DM" };
      const url = `${GRAPH_BASE}/${encodeURIComponent(igAccountId)}/messages?${auth}`;
      return graphFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: message },
          }),
        },
        accessToken,
        (json) => pick(json, "message_id")
      );
    },

    /** Oculta um comentário (moderação). */
    async hide(commentId: string): Promise<MetaResult> {
      const url = `${GRAPH_BASE}/${encodeURIComponent(commentId)}?${auth}`;
      return graphFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hide: true }),
        },
        accessToken,
        () => commentId
      );
    },

    /** Curte um comentário. */
    async like(commentId: string): Promise<MetaResult> {
      const url = `${GRAPH_BASE}/${encodeURIComponent(commentId)}/likes?${auth}`;
      return graphFetch(
        url,
        { method: "POST" },
        accessToken,
        () => commentId
      );
    },
  };
}

export type MetaClient = ReturnType<typeof createMetaClient>;
