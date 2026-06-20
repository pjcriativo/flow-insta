import { GRAPH_BASE, sanitizeError } from "./client";
import { withRetry } from "./rate-limit";

// ============================================================
// Máquina de publicação do Instagram (Content Publishing API).
// Fluxo correto: cria container -> faz polling de status_code até FINISHED ->
// media_publish. Trata image / carousel (child containers) / reel.
//
// INVARIANTE #5/#7: o token chega já descriptografado (lib/meta/tokens) e é
// usado SÓ como query param na borda. NUNCA aparece em log/erro — sanitizeError
// (reusado de client.ts) remove qualquer ocorrência.
//
// mediaUrls = URLs públicas/assinadas do Storage (TTL generoso) para o IG
// baixar a mídia server-side.
// ============================================================

export type IgMediaType = "image" | "carousel" | "reel";

export type PublishArgs = {
  /** Token em claro (borda). Nunca logar. */
  token: string;
  /** IG Business account id (user_channels.provider_account_id). */
  igUserId: string;
  mediaType: IgMediaType;
  caption: string;
  /** URLs das mídias (imagens em ordem para carrossel; vídeo para reel). */
  mediaUrls: string[];
};

export type PublishResult =
  | { ok: true; mediaId: string; permalink: string | null }
  | { ok: false; error: string };

// Polling do container: status_code FINISHED/PUBLISHED ok; ERROR/EXPIRED falha;
// IN_PROGRESS aguarda. ~40 tentativas x 2.5s = ~100s de teto.
const POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 2500;

/** Faz uma chamada à Graph e retorna o JSON parseado, sanitizando erros. */
async function graphJson(
  url: string,
  init: RequestInit,
  token: string
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await withRetry(() => fetch(url, init));
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Meta ${res.status}: ${sanitizeError(text, token).slice(0, 500)}` };
    }
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { ok: true, json };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "erro de rede";
    return { ok: false, error: sanitizeError(raw, token) };
  }
}

/**
 * Espera um container de mídia ficar pronto (status_code FINISHED). Obrigatório
 * para TODO container antes do media_publish — sem isto a Graph responde
 * "Media ID is not available".
 */
export async function waitForContainer(
  igUserId: string,
  containerId: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = `access_token=${encodeURIComponent(token)}`;
  const url = `${GRAPH_BASE}/${encodeURIComponent(containerId)}?fields=status_code,status&${auth}`;

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const r = await graphJson(url, { method: "GET" }, token);
    if (!r.ok) return { ok: false, error: r.error };
    const code = String(r.json.status_code ?? "");
    if (code === "FINISHED" || code === "PUBLISHED") return { ok: true };
    if (code === "ERROR" || code === "EXPIRED") {
      const status = typeof r.json.status === "string" ? r.json.status : code;
      return { ok: false, error: `Container ${code}: ${status}` };
    }
    // IN_PROGRESS (ou vazio): aguarda e tenta de novo.
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  return { ok: false, error: "Timeout aguardando o processamento da mídia (status_code != FINISHED)" };
}

/** Cria um container de mídia e retorna seu id. */
async function createContainer(
  igUserId: string,
  body: Record<string, string>,
  token: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = `access_token=${encodeURIComponent(token)}`;
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media?${auth}`;
  const r = await graphJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    token
  );
  if (!r.ok) return r;
  const id = typeof r.json.id === "string" ? r.json.id : null;
  if (!id) return { ok: false, error: "Container sem id na resposta da Meta" };
  return { ok: true, id };
}

/** Publica um container já FINISHED via media_publish. */
async function mediaPublish(
  igUserId: string,
  creationId: string,
  token: string
): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const auth = `access_token=${encodeURIComponent(token)}`;
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish?${auth}`;
  const r = await graphJson(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId }),
    },
    token
  );
  if (!r.ok) return r;
  const mediaId = typeof r.json.id === "string" ? r.json.id : null;
  if (!mediaId) return { ok: false, error: "media_publish sem id na resposta da Meta" };
  return { ok: true, mediaId };
}

/** Busca o permalink do post publicado (best-effort; null se falhar). */
async function fetchPermalink(mediaId: string, token: string): Promise<string | null> {
  const auth = `access_token=${encodeURIComponent(token)}`;
  const url = `${GRAPH_BASE}/${encodeURIComponent(mediaId)}?fields=permalink&${auth}`;
  const r = await graphJson(url, { method: "GET" }, token);
  if (!r.ok) return null;
  return typeof r.json.permalink === "string" ? r.json.permalink : null;
}

/**
 * Publica um post no Instagram. Trata image / carousel / reel.
 *   reel    -> container media_type REELS + video_url
 *   carousel-> child container por imagem (is_carousel_item), espera cada um,
 *              depois container CAROUSEL com children, espera, publica
 *   image   -> container image_url, espera, publica
 */
export async function publishInstagramPost(args: PublishArgs): Promise<PublishResult> {
  const { token, igUserId, mediaType, caption, mediaUrls } = args;

  if (!igUserId) return { ok: false, error: "IG account id (provider_account_id) ausente" };
  if (mediaUrls.length === 0) return { ok: false, error: "Nenhuma mídia para publicar" };

  let creationId: string;

  if (mediaType === "reel") {
    const c = await createContainer(
      igUserId,
      { media_type: "REELS", video_url: mediaUrls[0], caption },
      token
    );
    if (!c.ok) return c;
    const w = await waitForContainer(igUserId, c.id, token);
    if (!w.ok) return w;
    creationId = c.id;
  } else if (mediaType === "carousel") {
    // 1) Um child container por imagem; espera cada um ficar FINISHED.
    const childIds: string[] = [];
    for (const url of mediaUrls) {
      const child = await createContainer(
        igUserId,
        { image_url: url, is_carousel_item: "true" },
        token
      );
      if (!child.ok) return child;
      const w = await waitForContainer(igUserId, child.id, token);
      if (!w.ok) return w;
      childIds.push(child.id);
    }
    // 2) Container CAROUSEL com os children; espera; publica.
    const parent = await createContainer(
      igUserId,
      { media_type: "CAROUSEL", children: childIds.join(","), caption },
      token
    );
    if (!parent.ok) return parent;
    const wp = await waitForContainer(igUserId, parent.id, token);
    if (!wp.ok) return wp;
    creationId = parent.id;
  } else {
    // image
    const c = await createContainer(igUserId, { image_url: mediaUrls[0], caption }, token);
    if (!c.ok) return c;
    const w = await waitForContainer(igUserId, c.id, token);
    if (!w.ok) return w;
    creationId = c.id;
  }

  const pub = await mediaPublish(igUserId, creationId, token);
  if (!pub.ok) return pub;

  const permalink = await fetchPermalink(pub.mediaId, token);
  return { ok: true, mediaId: pub.mediaId, permalink };
}

/** Decide o media_type a partir das mídias do post (imagem única / carrossel). */
export function inferMediaType(mediaUrls: string[]): IgMediaType {
  return mediaUrls.length > 1 ? "carousel" : "image";
}
