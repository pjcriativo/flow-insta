// ============================================================
// Camada determinística de palavras-chave (portada do zip).
//
// generateVariations: a partir de uma keyword, gera variações normalizadas
// (acento, caixa, pontuação, com/sem espaço) para casar com o texto do usuário
// sem depender do LLM. O backend salva isso em keyword_responses.variations ao
// criar/editar; o matcher compara o texto recebido contra essas variações.
// ============================================================

/** Remove acentos, baixa a caixa e tira pontuação — forma canônica. */
export function normalizeText(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // pontuação -> espaço
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gera variações de uma keyword para o matcher determinístico:
 *  - forma normalizada (sem acento/caixa/pontuação)
 *  - sem espaços (ex.: "quero comprar" -> "querocomprar")
 *  - a keyword crua em minúsculas
 * Sempre únicas e não-vazias.
 */
export function generateVariations(keyword: string): string[] {
  const base = normalizeText(keyword);
  if (!base) return [];
  const variations = new Set<string>();
  variations.add(base);
  variations.add(base.replace(/\s+/g, "")); // sem espaço
  variations.add(keyword.toLowerCase().trim()); // crua minúscula
  return [...variations].filter(Boolean);
}

export type KeywordRow = {
  id: string;
  keyword: string;
  variations: string[];
  response_message: string;
  active: boolean;
};

/**
 * Acha a primeira keyword_responses ativa cujo texto casa o recebido.
 * Casa se alguma variação normalizada aparece como SUBSTRING do texto
 * normalizado (cobre "quero comprar isso" casando "quero comprar"). Também
 * casa a forma sem-espaço. Retorna a linha ou null.
 */
export function matchKeyword(text: string, rows: KeywordRow[]): KeywordRow | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const noSpace = normalized.replace(/\s+/g, "");

  for (const row of rows) {
    if (!row.active) continue;
    // Garante que a própria keyword também é considerada, além das variations.
    const candidates = row.variations.length > 0 ? row.variations : generateVariations(row.keyword);
    for (const raw of candidates) {
      const v = normalizeText(raw);
      if (!v) continue;
      if (normalized.includes(v)) return row;
      const vNoSpace = v.replace(/\s+/g, "");
      if (vNoSpace && noSpace.includes(vNoSpace)) return row;
    }
  }
  return null;
}
