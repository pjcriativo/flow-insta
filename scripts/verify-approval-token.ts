/**
 * Verificação standalone do token de aprovação (sem framework de teste).
 * Roda com: npx tsx scripts/verify-approval-token.ts
 *
 * Prova os invariantes:
 *  - token válido => ok:true
 *  - assinatura adulterada => ok:false
 *  - payload adulterado (assinatura não bate) => ok:false
 *  - token expirado => ok:false
 *  - token assinado com OUTRO segredo => ok:false
 *  - hashToken(token) != token (e é estável)
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Carrega APPROVAL_LINK_SECRET do .env (sem depender de framework).
function loadEnv() {
  try {
    const env = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    for (const line of env.split("\n")) {
      const m = line.match(/^APPROVAL_LINK_SECRET=(.+)$/);
      if (m) process.env.APPROVAL_LINK_SECRET = m[1].trim();
    }
  } catch {
    /* ignore */
  }
}
loadEnv();

if (!process.env.APPROVAL_LINK_SECRET) {
  console.error("APPROVAL_LINK_SECRET ausente no .env — abortando.");
  process.exit(1);
}

// require após carregar o env (o módulo lê process.env no load).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { signToken, verifyToken, hashToken } = require("../lib/approvals/token");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHmac } = require("crypto");

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

const base = {
  link_id: "11111111-1111-1111-1111-111111111111",
  collection_id: "22222222-2222-2222-2222-222222222222",
  scope: {},
};

// 1. Token válido
const valid = signToken({ ...base, expiresInMs: 60_000 });
const r1 = verifyToken(valid);
check("token válido => ok:true", r1.ok === true);
check(
  "payload retornado bate com collection_id",
  r1.ok === true && r1.payload.collection_id === base.collection_id
);

// 2. Assinatura adulterada (troca o último char da assinatura)
const [enc, sig] = valid.split(".");
const tamperedSig = `${enc}.${sig.slice(0, -1)}${sig.slice(-1) === "A" ? "B" : "A"}`;
check("assinatura adulterada => ok:false", verifyToken(tamperedSig).ok === false);

// 3. Payload adulterado (muda o payload, mantém a assinatura antiga)
const fakePayload = Buffer.from(
  JSON.stringify({ ...base, exp: Date.now() + 60_000 })
).toString("base64url");
check("payload adulterado => ok:false", verifyToken(`${fakePayload}.${sig}`).ok === false);

// 4. Token expirado
const expired = signToken({ ...base, expiresInMs: -1000 });
check("token expirado => ok:false", verifyToken(expired).ok === false);

// 5. Token assinado com OUTRO segredo (forja externa)
const encOther = Buffer.from(
  JSON.stringify({ ...base, exp: Date.now() + 60_000 })
).toString("base64url");
const sigOther = createHmac("sha256", "outro-segredo-qualquer")
  .update(encOther)
  .digest("base64url");
check("segredo errado => ok:false", verifyToken(`${encOther}.${sigOther}`).ok === false);

// 6. Lixo / formatos inválidos
check("string vazia => ok:false", verifyToken("").ok === false);
check("sem ponto => ok:false", verifyToken("semponto").ok === false);
check("undefined => ok:false", verifyToken(undefined).ok === false);

// 7. hashToken: é sha256 hex, != token cru, e estável
const h = hashToken(valid);
check("hash != token cru", h !== valid);
check("hash é sha256 hex (64 chars)", /^[0-9a-f]{64}$/.test(h));
check("hash é determinístico", hashToken(valid) === h);

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
