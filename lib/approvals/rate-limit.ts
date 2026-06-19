// Rate-limit simples por IP, em memória (janela deslizante).
//
// NOTA: em serverless (Vercel) a memória não é compartilhada entre instâncias,
// então isto é best-effort — mitiga abuso/enumeração de uma mesma instância,
// não é um limitador distribuído. Para produção sob ataque, migrar para um
// store compartilhado (Upstash/Redis). Suficiente para o escopo atual.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Limpeza preguiçosa para não crescer indefinidamente.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}

/**
 * Retorna { allowed, retryAfterSec }. Conta uma tentativa por chamada.
 * @param key normalmente `${rota}:${ip}`
 * @param limit nº de requisições permitidas na janela
 * @param windowMs tamanho da janela
 */
export function rateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);

  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (b.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }

  b.count++;
  return { allowed: true, retryAfterSec: 0 };
}

/** Extrai o IP do request (Vercel/Proxy). */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
