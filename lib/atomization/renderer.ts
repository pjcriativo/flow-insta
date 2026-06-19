import type { RenderResult } from "@/types/atomization";

// =========================================================
// Porta VideoRenderer — abstrai o render de vídeo (ffmpeg+yt-dlp).
// NUNCA roda em serverless. Hoje: MockVideoRenderer. Depois: HttpVideoRenderer
// apontando para o worker externo (VIDEO_RENDERER_URL).
// =========================================================

export type RenderRequest = {
  jobId: string;
  clipIndex: number;
  organizationId: string;
  sourceUrl: string;
  startSeconds: number;
  endSeconds: number;
  idempotencyKey: string; // `${jobId}:${clipIndex}`
};

export interface VideoRenderer {
  render(req: RenderRequest): Promise<RenderResult>;
}

/**
 * Mock: não renderiza de verdade. Retorna paths placeholder determinísticos
 * (baseados na idempotencyKey) para o pipeline funcionar end-to-end.
 */
export class MockVideoRenderer implements VideoRenderer {
  async render(req: RenderRequest): Promise<RenderResult> {
    const base = `atomization/${req.organizationId}/${req.jobId}/${req.clipIndex}`;
    return {
      videoAssetPath: `${base}/reel.mp4`,
      thumbnailPath: `${base}/thumb.jpg`,
    };
  }
}

/**
 * Worker externo (HTTP). Mantido aqui como esqueleto: quando você tiver o
 * worker, basta setar VIDEO_RENDERER_URL/SECRET; getVideoRenderer passa a usá-lo.
 */
export class HttpVideoRenderer implements VideoRenderer {
  constructor(private url: string, private secret: string) {}

  async render(req: RenderRequest): Promise<RenderResult> {
    const res = await fetch(`${this.url}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.secret}`,
        "Idempotency-Key": req.idempotencyKey,
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`Render worker error: ${res.status}`);
    }
    const data = (await res.json()) as RenderResult;
    return data;
  }
}

/** Fábrica: usa o worker HTTP se configurado, senão o mock. */
export function getVideoRenderer(): VideoRenderer {
  const url = process.env.VIDEO_RENDERER_URL;
  const secret = process.env.VIDEO_RENDERER_SECRET;
  if (url && secret) {
    return new HttpVideoRenderer(url, secret);
  }
  return new MockVideoRenderer();
}
