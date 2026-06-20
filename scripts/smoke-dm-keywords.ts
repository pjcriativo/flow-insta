/**
 * Smoke test do delta da Fase 4 (camada determinística de keyword).
 *
 * Prova:
 *   1. normalizeText/matchKeyword: casa apesar de acento, caixa, pontuação e
 *      espaço (a parte central do zip — sem LLM).
 *   2. generateVariations: gera a forma normalizada + sem-espaço + crua.
 *   3. CRUD real de keyword_responses (via service_role) + filtro org-scoped,
 *      e que a coluna variations é persistida.
 *
 * O envio real à Meta exige canal IG conectado (não há) — coberto pelo wiring
 * em decide-and-act, testável quando houver canal. Aqui validamos a lógica.
 *
 * Uso: env -u SUPABASE_ACCESS_TOKEN npx tsx scripts/smoke-dm-keywords.ts
 */
import "dotenv/config";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { generateVariations, matchKeyword, normalizeText, type KeywordRow } from "@/lib/dm-pilot/keywords";

const TAG = "[smoke-dm-kw]";

function check(label: string, cond: boolean): boolean {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  return cond;
}

async function main() {
  let ok = true;

  console.log(`${TAG} == 1. normalize + match (acento/caixa/pontuação/espaço) ==`);
  ok = check("normalizeText('Preço!') === 'preco'", normalizeText("Preço!") === "preco") && ok;

  const rows: KeywordRow[] = [
    { id: "1", keyword: "preço", variations: generateVariations("preço"), response_message: "R$ 99", active: true },
    { id: "2", keyword: "quero comprar", variations: generateVariations("quero comprar"), response_message: "Link!", active: true },
    { id: "3", keyword: "inativa", variations: generateVariations("inativa"), response_message: "x", active: false },
  ];

  ok = check("'qual o PREÇO?' casa 'preço'", matchKeyword("qual o PREÇO?", rows)?.id === "1") && ok;
  ok = check("'Quero Comprar isso' casa 'quero comprar'", matchKeyword("Quero Comprar isso", rows)?.id === "2") && ok;
  ok = check("'querocomprar' (sem espaço) casa", matchKeyword("querocomprar agora", rows)?.id === "2") && ok;
  ok = check("'oi tudo bem' NÃO casa nada", matchKeyword("oi tudo bem", rows) === null) && ok;
  ok = check("keyword inativa NÃO casa", matchKeyword("inativa aqui", rows) === null) && ok;

  console.log(`${TAG} == 2. generateVariations ==`);
  const v = generateVariations("Olá Mundo!");
  ok = check("inclui forma normalizada 'ola mundo'", v.includes("ola mundo")) && ok;
  ok = check("inclui forma sem-espaço 'olamundo'", v.includes("olamundo")) && ok;

  console.log(`${TAG} == 3. CRUD real keyword_responses (org-scoped) ==`);
  const admin = getSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("id").limit(1).maybeSingle();
  if (!org) throw new Error("sem organização para o teste");
  const orgId = org.id as string;

  const variations = generateVariations("frete grátis");
  const { data: ins, error: insErr } = await admin
    .from("keyword_responses")
    .insert({
      organization_id: orgId,
      keyword: "frete grátis",
      variations,
      response_message: `${TAG} resposta`,
      active: true,
    })
    .select("id, variations")
    .single();
  if (insErr || !ins) throw new Error(`insert: ${insErr?.message}`);

  try {
    ok = check("variations persistidas no banco", Array.isArray(ins.variations) && ins.variations.length > 0) && ok;

    // Filtro org-scoped: carrega keywords ativas dessa org.
    const { data: loaded } = await admin
      .from("keyword_responses")
      .select("id, keyword, variations, response_message, active")
      .eq("organization_id", orgId)
      .eq("active", true);
    const found = (loaded ?? []).some((k) => k.id === ins.id);
    ok = check("keyword carregada pelo filtro org", found) && ok;

    // Match contra a linha do banco, com acento removido.
    const hit = matchKeyword("tem FRETE GRATIS?", (loaded ?? []) as KeywordRow[]);
    ok = check("'tem FRETE GRATIS?' casa a linha do banco", hit?.id === ins.id) && ok;
  } finally {
    await admin.from("keyword_responses").delete().eq("id", ins.id);
    console.log(`${TAG} limpeza concluída`);
  }

  console.log(ok ? `\n${TAG} SMOKE TEST PASSOU ✓` : `\n${TAG} SMOKE TEST FALHOU ✗`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`${TAG} ERRO inesperado:`, e);
  process.exit(1);
});
