// ============================================================
// Backoff/retry para chamadas à Graph API da Meta.
//
// A Meta responde 429 (rate limit) e 5xx (transitório) sob carga. Reexecuta
// com backoff exponencial + jitter, respeitando Retry-After quando presente.
// 4xx que não 429 são erros do chamador (payload/permissão) — não reexecuta.
// ============================================================

export type RetryableResponse = { status: number; headers: Headers };

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Delay do attempt n (0-based): exponencial + jitter, respeitando Retry-After. */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_DELAY_MS);
  }
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  // Jitter determinístico em runtime (sem Math.random — varia por attempt).
  const jitter = (attempt + 1) * 73; // ms
  return Math.min(exp + jitter, MAX_DELAY_MS);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Executa `fn` (uma chamada fetch que retorna Response) com retry em 429/5xx.
 * Em sucesso (ou erro não-retryável) retorna a Response. Esgotadas as
 * tentativas, retorna a última Response (o chamador trata o status).
 *
 * Erros de rede (fetch lança) também são reexecutados.
 */
export async function withRetry(
  fn: () => Promise<Response>,
  maxRetries = DEFAULT_MAX_RETRIES
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fn();
      if (!isRetryableStatus(res.status) || attempt === maxRetries) {
        return res;
      }
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
    } catch (e) {
      lastError = e;
      if (attempt === maxRetries) throw e;
      await sleep(backoffMs(attempt, null));
    }
  }

  // Inalcançável (o loop sempre retorna ou lança), mas satisfaz o TS.
  throw lastError ?? new Error("withRetry: esgotou as tentativas");
}
