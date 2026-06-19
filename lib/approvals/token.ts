import { createHmac, createHash, timingSafeEqual } from "crypto";
import type {
  ApprovalTokenPayload,
  TokenVerifyResult,
} from "@/types/approvals";

const SECRET = process.env.APPROVAL_LINK_SECRET;

function getSecret(): string {
  if (!SECRET) {
    throw new Error("APPROVAL_LINK_SECRET is not defined");
  }
  return SECRET;
}

function hmac(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

/**
 * Assina um token de aprovação: `<payload-base64url>.<hmac>`.
 * O `exp` é embutido no payload. O token CRU nunca deve ser persistido —
 * grave apenas `hashToken(token)` em approval_links.token_hash.
 */
export function signToken(
  payload: Omit<ApprovalTokenPayload, "exp"> & { expiresInMs: number }
): string {
  const fullPayload: ApprovalTokenPayload = {
    link_id: payload.link_id,
    collection_id: payload.collection_id,
    scope: payload.scope ?? {},
    exp: Date.now() + payload.expiresInMs,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  return `${encoded}.${hmac(encoded)}`;
}

/**
 * Verifica assinatura + expiração. NUNCA lança em caso de token inválido —
 * retorna `{ ok: false }` (genérico, anti-enumeração). Só retorna o payload
 * se a assinatura for válida E o token não estiver expirado.
 */
export function verifyToken(token: string | undefined | null): TokenVerifyResult {
  try {
    if (!token || typeof token !== "string") return { ok: false };

    const dot = token.indexOf(".");
    if (dot <= 0) return { ok: false };

    const encoded = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!encoded || !signature) return { ok: false };

    const expected = hmac(encoded);

    // timingSafeEqual exige buffers do mesmo tamanho; tamanhos diferentes => inválido.
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return { ok: false };
    if (!timingSafeEqual(sigBuf, expBuf)) return { ok: false };

    let payload: ApprovalTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    } catch {
      return { ok: false };
    }

    if (
      !payload ||
      typeof payload.link_id !== "string" ||
      typeof payload.collection_id !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return { ok: false };
    }

    if (payload.exp < Date.now()) return { ok: false };

    return { ok: true, payload: { ...payload, scope: payload.scope ?? {} } };
  } catch {
    // Qualquer erro inesperado => inválido genérico.
    return { ok: false };
  }
}

/**
 * Hash do token cru (sha256 hex) — é o ÚNICO derivado que vai para o banco
 * (approval_links.token_hash). Usado para buscar o link sem armazenar o token.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
