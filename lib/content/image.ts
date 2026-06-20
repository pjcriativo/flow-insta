import { toFile } from "openai";
import { getOpenAI } from "@/lib/ai";
import { buildBrandPromptBase } from "./copy";
import { BrandProfile, ContentType, Slide } from "./types";

// =========================================================
// Geração de imagem (post / carrossel / thumbnail).
// Portado do protótipo (openai.service.js). Mantém o TRUQUE DE CONTINUIDADE do
// carrossel: o slide 1 é gerado do zero (ou a partir de uma referência da
// image_library); os slides 2+ usam a imagem do slide 1 como referência via
// images.edit, forçando estilo/paleta/personagem consistentes.
//
// Modelo: OPENAI_IMAGE_MODEL (default gpt-image-1). quality 'high' (fiel ao
// protótipo). Retorna { b64, mimeType } — quem persiste sobe no Storage.
// =========================================================

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const MAX_PROMPT_LEN = 4000;

type ImageSize = "1024x1536" | "1536x1024";

/** 16:9 para thumbnail (CTR); 4:5 para feed/carrossel do Instagram. */
export function sizeForContentType(t: string): ImageSize {
  return t === "thumbnail" ? "1536x1024" : "1024x1536";
}

/** Garante prompt não-vazio e dentro do limite do modelo. */
export function sanitizePrompt(prompt: string): string {
  const trimmed = (prompt ?? "").trim();
  const safe = trimmed || "Imagem de marca para redes sociais, alta qualidade.";
  return safe.length > MAX_PROMPT_LEN ? safe.slice(0, MAX_PROMPT_LEN) : safe;
}

export function buildSlidePrompt(args: {
  brand: BrandProfile | null;
  slide: Pick<Slide, "role" | "headline" | "body" | "visual_description">;
  contentType: ContentType;
  isFirstSlide: boolean;
  hasReference: boolean;
}): string {
  const { brand, slide, contentType, isFirstSlide, hasReference } = args;
  const size = sizeForContentType(contentType);
  const continuity =
    hasReference && !isFirstSlide
      ? "CONTINUIDADE: mantenha o mesmo estilo, paleta, iluminação e personagem da imagem de referência."
      : "";
  const dragHint =
    contentType === "carousel" && isFirstSlide && slide.role === "capa"
      ? 'Adicione no canto inferior esquerdo uma seta amarela com "ARRASTA →".'
      : "";
  const ctaHint = slide.role === "cta" ? "Inclua um CTA visual forte (botão, badge, destaque)." : "";
  const thumbHint =
    contentType === "thumbnail"
      ? "Texto MUITO grande e legível, contraste altíssimo, elemento focal forte. Composição 16:9 para CTR."
      : "";
  const prompt = `
${buildBrandPromptBase(brand)}

FORMATO: ${size}px ${contentType === "thumbnail" ? "(16:9, thumbnail)" : "(4:5, Instagram)"}
${continuity}

DESCRIÇÃO VISUAL:
${slide.visual_description || "—"}

TEXTO NA IMAGEM:
- Headline: "${slide.headline || ""}"
${slide.body ? `- Apoio: "${slide.body}"` : ""}

${thumbHint}
${dragHint}
${ctaHint}`.trim();
  return sanitizePrompt(prompt);
}

export type GeneratedImage = { b64: string; mimeType: string };

/**
 * Gera UMA imagem. Se `referenceBuffers` tiver itens, usa images.edit
 * (continuidade); senão images.generate. quality 'high'. Lança em erro de API
 * (o runner trata: marca o slide failed e segue).
 */
export async function generateImage(args: {
  prompt: string;
  contentType: ContentType;
  referenceBuffers?: Buffer[];
}): Promise<GeneratedImage> {
  const { prompt, contentType, referenceBuffers } = args;
  const size = sizeForContentType(contentType);
  const openai = getOpenAI();

  let b64: string | undefined;

  if (referenceBuffers && referenceBuffers.length > 0) {
    // Continuidade: edita a partir da(s) imagem(ns) de referência.
    const files = await Promise.all(
      referenceBuffers.map((buf, i) =>
        toFile(buf, `ref-${i}.png`, { type: "image/png" })
      )
    );
    const res = await openai.images.edit({
      model: IMAGE_MODEL,
      image: files.length === 1 ? files[0] : files,
      prompt,
      size,
      quality: "high",
    });
    b64 = res.data?.[0]?.b64_json;
  } else {
    const res = await openai.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size,
      quality: "high",
    });
    b64 = res.data?.[0]?.b64_json;
  }

  if (!b64) throw new Error("A IA não retornou imagem (b64 ausente)");
  return { b64, mimeType: "image/png" };
}
