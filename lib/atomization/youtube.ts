import type { YouTubeMeta } from "@/types/atomization";

/**
 * Extrai o videoId de uma URL do YouTube (watch, youtu.be, shorts, embed).
 * Retorna null se não for uma URL válida do YouTube.
 */
export function parseYouTubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return isValidId(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v");
      return id && isValidId(id) ? id : null;
    }
    const m = u.pathname.match(/^\/(shorts|embed|v)\/([^/?]+)/);
    if (m && isValidId(m[2])) return m[2];
  }

  return null;
}

function isValidId(id: string | undefined | null): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * Carrega metadados do vídeo e confirma que existe e é público.
 *
 * - Se YOUTUBE_API_KEY estiver setado: usa a Data API (título, canal, duração).
 * - Senão: usa o oEmbed público (título + canal). Se o oEmbed responde 200,
 *   o vídeo é público/existente; 401/403/404 => indisponível.
 *
 * Lança Error("INVALID_URL") se a URL não for do YouTube,
 * Error("VIDEO_UNAVAILABLE") se o vídeo não existe ou é privado.
 */
export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta> {
  const videoId = parseYouTubeId(url);
  if (!videoId) throw new Error("INVALID_URL");

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    return fetchViaApi(videoId, apiKey);
  }
  return fetchViaOEmbed(videoId);
}

async function fetchViaApi(videoId: string, apiKey: string): Promise<YouTubeMeta> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`
  );
  if (!res.ok) throw new Error("VIDEO_UNAVAILABLE");
  const json = (await res.json()) as {
    items?: {
      snippet?: { title?: string; channelTitle?: string };
      contentDetails?: { duration?: string };
      status?: { privacyStatus?: string };
    }[];
  };
  const item = json.items?.[0];
  if (!item) throw new Error("VIDEO_UNAVAILABLE");
  if (item.status?.privacyStatus === "private") throw new Error("VIDEO_UNAVAILABLE");

  return {
    videoId,
    title: item.snippet?.title ?? "Vídeo do YouTube",
    channelTitle: item.snippet?.channelTitle ?? null,
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
    available: true,
  };
}

async function fetchViaOEmbed(videoId: string): Promise<YouTubeMeta> {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  );
  // oEmbed retorna 401/403/404 para vídeos privados/inexistentes.
  if (!res.ok) throw new Error("VIDEO_UNAVAILABLE");
  const json = (await res.json()) as { title?: string; author_name?: string };
  return {
    videoId,
    title: json.title ?? "Vídeo do YouTube",
    channelTitle: json.author_name ?? null,
    durationSeconds: null, // oEmbed não traz duração
    available: true,
  };
}

/** Converte duração ISO 8601 (PT#H#M#S) em segundos. */
function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + s;
}
