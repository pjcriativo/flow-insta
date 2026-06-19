import { promises as dns } from "dns";
import { createHash } from "crypto";

// Prefixo do registro TXT que o cliente cria no DNS para provar posse do domínio.
const TXT_PREFIX = "flow-insta-verify";

/**
 * Token de verificação determinístico por (org, domínio). Não é segredo —
 * só prova que quem controla o DNS é quem pediu a verificação.
 */
export function domainVerificationToken(orgId: string, domain: string): string {
  return createHash("sha256")
    .update(`${orgId}:${domain.toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

/** O valor TXT que o cliente deve criar: `flow-insta-verify=<token>`. */
export function expectedTxtRecord(orgId: string, domain: string): string {
  return `${TXT_PREFIX}=${domainVerificationToken(orgId, domain)}`;
}

/**
 * Verifica via DNS se o domínio tem o registro TXT esperado.
 * Retorna true só se encontrar o valor exato. Falhas de DNS => false.
 */
export async function verifyDomainTxt(orgId: string, domain: string): Promise<boolean> {
  const clean = sanitizeDomain(domain);
  if (!clean) return false;
  const expected = expectedTxtRecord(orgId, clean);
  try {
    const records = await dns.resolveTxt(clean);
    // resolveTxt retorna string[][] (cada record pode vir fragmentado).
    return records.some((parts) => parts.join("").trim() === expected);
  } catch {
    return false;
  }
}

/** Normaliza/valida um domínio (sem protocolo, sem path, lowercase). */
export function sanitizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  // Validação simples de hostname (anti host-header injection / open redirect).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  if (d.includes("..")) return null;
  return d;
}

/**
 * Anti host-header injection: confirma que o host do request corresponde a um
 * domínio verificado da org. Usado quando se serve a página por domínio próprio.
 */
export function hostMatchesVerifiedDomain(
  host: string | null,
  verifiedDomain: string | null
): boolean {
  if (!host || !verifiedDomain) return false;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return h === verifiedDomain.toLowerCase();
}
