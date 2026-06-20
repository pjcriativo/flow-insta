import { getOpenAI, AI_MODEL } from "@/lib/ai";
import { parseAiJson } from "@/lib/atomization/schemas";
import {
  BrandProfile,
  ContentType,
  CopyResult,
  CopyResultSchema,
  Slide,
  SingleSlideResultSchema,
} from "./types";

// =========================================================
// Geração de copy (post / carrossel / thumbnail) na voz da marca.
// Portado do protótipo single-tenant (openai.service.js). O conteúdo dos
// prompts é a parte PROVADA — preservado. Adaptado para TS + Zod + a tabela
// fundida brand_profiles.
//
// Modelo: OPENAI_MODEL (via AI_MODEL). response_format json_object. Toda saída
// é validada por Zod (CopyResultSchema / SingleSlideResultSchema) antes de
// retornar — quem persiste recebe dados já normalizados.
// =========================================================

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || AI_MODEL;

/**
 * Bloco de identidade da marca injetado em TODA geração (copy e imagem).
 * Degrada graciosamente: marca nula -> string vazia; campos ausentes -> '—'.
 */
export function buildBrandPromptBase(brand: BrandProfile | null): string {
  if (!brand) return "";
  const palette = (brand.color_palette ?? [])
    .map(
      (c) =>
        `- ${c.name || "—"} (${c.hex || "—"})${c.role ? ` — ${c.role}` : ""}`
    )
    .join("\n");
  const typo = brand.typography ?? {};
  const mood = brand.mood_keywords ?? [];
  return `
IDENTIDADE VISUAL DA MARCA (aplicar em TODO conteúdo):
- Marca: "${brand.brand_name ?? ""}"${brand.instagram_handle ? ` (${brand.instagram_handle})` : ""}
- Sobre: ${brand.description || "—"}
- Público: ${brand.target_audience || "—"}
- Tom de voz: ${brand.tone_of_voice || "—"}

PALETA DE CORES:
${palette || "- (não definida)"}

LOGOTIPO: ${brand.logo_placement || "(sem instrução)"}
TIPOGRAFIA: ${typo.primary_font || "—"} (principal)${typo.secondary_font ? `, ${typo.secondary_font} (secundária)` : ""}.${typo.style_notes ? ` ${typo.style_notes}` : ""}
ESTILO VISUAL: ${brand.visual_style || "—"}
MOOD: ${mood.join(", ") || "—"}`.trim();
}

/**
 * System prompt por tipo de conteúdo. Conteúdo preservado do protótipo:
 *  - carousel: slide 1 = capa c/ gancho, meio = desenvolvimento, último = CTA.
 *  - post: 1 slide marcante (role 'post').
 *  - thumbnail: 16:9, alto contraste, ≤4 palavras (role 'thumbnail').
 */
function systemPromptFor(contentType: ContentType): string {
  const jsonShape = `Responda APENAS com um objeto JSON no formato:
{ "slides": [ { "slide_number": <int>, "role": <string>, "headline": <string>, "body": <string>, "visual_description": <string> } ] }
Sem texto fora do JSON.`;

  if (contentType === "carousel") {
    return `Você é um copywriter sênior de carrosséis para Instagram. Crie um carrossel coeso e envolvente.
REGRAS:
- O slide 1 é a CAPA: um gancho forte que para o scroll (role "capa").
- Os slides do meio DESENVOLVEM a ideia, um ponto por slide (role "desenvolvimento").
- O ÚLTIMO slide é o CTA: chamada para ação clara (role "cta").
- headline: curta e impactante. body: texto de apoio. visual_description: descreva a imagem do slide (cena, elementos, texto na imagem) de forma que um gerador de imagem consiga produzir.
${jsonShape}`;
  }

  if (contentType === "thumbnail") {
    return `Você é um designer de thumbnails de alta conversão (16:9).
REGRAS:
- UMA imagem só (1 slide, role "thumbnail").
- headline: NO MÁXIMO 4 palavras, altíssimo contraste e impacto.
- visual_description: composição 16:9, elemento focal forte, texto grande e legível, pensada para CTR.
${jsonShape}`;
  }

  // post
  return `Você é um copywriter de posts de imagem única para Instagram.
REGRAS:
- UMA imagem marcante (1 slide, role "post").
- headline: gancho/título forte. body: legenda de apoio curta.
- visual_description: descreva a imagem (cena, elementos, texto na imagem) para um gerador de imagem.
${jsonShape}`;
}

/** Monta o prompt do usuário com a identidade da marca + a ideia/contexto. */
function buildUserPrompt(args: {
  brand: BrandProfile | null;
  contentType: ContentType;
  idea: string;
  referenceContent?: string | null;
  slideCount?: number | null;
  voiceInstruction?: string | null;
}): string {
  const { brand, contentType, idea, referenceContent, slideCount, voiceInstruction } = args;
  const base = buildBrandPromptBase(brand);
  const slideHint =
    contentType === "carousel" && slideCount
      ? `\nNÚMERO DE SLIDES: gere exatamente ${slideCount} slides (incluindo capa e CTA).`
      : "";
  const ref = referenceContent ? `\n\nCONTEÚDO DE REFERÊNCIA:\n${referenceContent}` : "";
  const voice = voiceInstruction ? `\n\n${voiceInstruction}` : "";
  return `${base ? base + "\n\n" : ""}IDEIA / BRIEFING:\n${idea}${slideHint}${ref}${voice}`.trim();
}

/** Normaliza os slides: ordena por slide_number e re-sequencia 1..N. */
function normalizeSlides(result: CopyResult): CopyResult {
  const slides = [...result.slides]
    .sort((a, b) => a.slide_number - b.slide_number)
    .map((s, i) => ({ ...s, slide_number: i + 1, body: s.body ?? "" }));
  return { slides };
}

export type GenerateCopyArgs = {
  brand: BrandProfile | null;
  contentType: ContentType;
  idea: string;
  referenceContent?: string | null;
  slideCount?: number | null;
  voiceInstruction?: string | null;
};

/**
 * Gera a copy de um projeto. Chama o modelo de texto, faz parse defensivo,
 * valida com Zod e normaliza. Retorna { ok, data } | { ok:false, error } —
 * nunca lança por causa de saída malformada da IA.
 */
export async function generateCopy(
  args: GenerateCopyArgs
): Promise<{ ok: true; data: CopyResult } | { ok: false; error: string }> {
  const completion = await getOpenAI().chat.completions.create({
    model: TEXT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPromptFor(args.contentType) },
      { role: "user", content: buildUserPrompt(args) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  const parsed = parseAiJson(CopyResultSchema, raw);
  if (!parsed.ok) return parsed;
  return { ok: true, data: normalizeSlides(parsed.data) };
}

export type RegenerateSlideArgs = {
  brand: BrandProfile | null;
  contentType: ContentType;
  idea: string;
  /** O slide a reescrever (mantém slide_number e role). */
  slide: Pick<Slide, "slide_number" | "role" | "headline" | "body" | "visual_description">;
  /** Os demais slides, para manter coerência com o conjunto. */
  otherSlides: Array<Pick<Slide, "slide_number" | "role" | "headline">>;
  voiceInstruction?: string | null;
};

/**
 * Reescreve UM slide mantendo a coerência com o restante do carrossel.
 * Retorna o slide validado (mesmo slide_number/role) ou erro.
 */
export async function regenerateSlideCopy(
  args: RegenerateSlideArgs
): Promise<{ ok: true; data: Slide } | { ok: false; error: string }> {
  const base = buildBrandPromptBase(args.brand);
  const context = args.otherSlides
    .map((s) => `- Slide ${s.slide_number} (${s.role}): ${s.headline}`)
    .join("\n");
  const voice = args.voiceInstruction ? `\n\n${args.voiceInstruction}` : "";

  const system = `Você é um copywriter sênior. Reescreva UM slide de um ${args.contentType}, mantendo coerência com os demais e a voz da marca.
Mantenha o mesmo slide_number (${args.slide.slide_number}) e o mesmo role ("${args.slide.role}").
Responda APENAS com JSON: { "slide": { "slide_number": ${args.slide.slide_number}, "role": "${args.slide.role}", "headline": <string>, "body": <string>, "visual_description": <string> } }`;

  const user = `${base ? base + "\n\n" : ""}IDEIA / BRIEFING:\n${args.idea}

DEMAIS SLIDES (para manter coerência):
${context || "(nenhum)"}

SLIDE ATUAL A REESCREVER:
- headline: ${args.slide.headline}
- body: ${args.slide.body ?? ""}
- visual_description: ${args.slide.visual_description}${voice}`;

  const completion = await getOpenAI().chat.completions.create({
    model: TEXT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  const parsed = parseAiJson(SingleSlideResultSchema, raw);
  if (!parsed.ok) return parsed;
  // Força o slide_number/role originais (o modelo pode desviar).
  const slide: Slide = {
    ...parsed.data.slide,
    slide_number: args.slide.slide_number,
    role: args.slide.role,
    body: parsed.data.slide.body ?? "",
  };
  return { ok: true, data: slide };
}
