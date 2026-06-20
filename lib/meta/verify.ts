import { createHmac, timingSafeEqual } from "crypto";

const APP_SECRET = process.env.META_APP_SECRET;

/**
 * Valida o header X-Hub-Signature-256 de um POST do webhook da Meta.
 *
 * INVARIANTE #1: todo POST do webhook precisa passar por aqui ANTES de gravar
 * qualquer coisa. A assinatura é HMAC-SHA256 do corpo CRU (bytes exatos que a
 * Meta enviou) com META_APP_SECRET, no formato "sha256=<hex>".
 *
 * Recebe o corpo como string crua (NÃO o JSON re-serializado — re-serializar
 * muda os bytes e quebra a verificação). Comparação em tempo constante.
 *
 * Retorna false (nunca lança) para qualquer entrada malformada — o chamador
 * responde 401 sem gravar.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!APP_SECRET) {
    console.error("[meta/verify] META_APP_SECRET não configurado");
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", APP_SECRET).update(rawBody, "utf-8").digest("hex");

  // timingSafeEqual exige buffers do mesmo tamanho — checa antes p/ evitar throw.
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
