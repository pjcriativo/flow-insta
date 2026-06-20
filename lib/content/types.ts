import { z } from "zod";

// =========================================================
// Tipos e schemas Zod do Agente de Post/Carrossel.
// Espelham as colunas de public.brand_profiles / content_projects /
// content_slides. Toda saída de IA é validada antes de persistir.
// =========================================================

// --- Marca (brand_profiles) ---

export const ColorSchema = z.object({
  name: z.string().optional(),
  hex: z.string().optional(),
  role: z.string().optional(),
});

export const TypographySchema = z.object({
  primary_font: z.string().optional(),
  secondary_font: z.string().optional(),
  style_notes: z.string().optional(),
});

// Subconjunto de brand_profiles usado para montar os prompts. Tolerante a nulos
// (a marca pode estar incompleta) — buildBrandPromptBase degrada graciosamente.
export const BrandProfileSchema = z.object({
  brand_name: z.string().nullable().optional(),
  instagram_handle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  target_audience: z.string().nullable().optional(),
  tone_of_voice: z.string().nullable().optional(),
  color_palette: z.array(ColorSchema).nullable().optional(),
  logo_placement: z.string().nullable().optional(),
  typography: TypographySchema.nullable().optional(),
  visual_style: z.string().nullable().optional(),
  mood_keywords: z.array(z.string()).nullable().optional(),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

// --- Tipos de conteúdo ---

export const CONTENT_TYPES = ["post", "carousel", "thumbnail"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const SLIDE_ROLES = [
  "capa",
  "desenvolvimento",
  "cta",
  "post",
  "thumbnail",
] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

// --- SAÍDA DA IA: copy de um slide ---
// A IA retorna { slides: [...] }. Validamos cada slide estritamente.
export const SlideSchema = z.object({
  slide_number: z.number().int().min(1),
  role: z.enum(SLIDE_ROLES),
  headline: z.string().min(1).max(200),
  body: z.string().max(800).nullable().optional().default(""),
  visual_description: z.string().min(1).max(1200),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CopyResultSchema = z.object({
  slides: z.array(SlideSchema).min(1).max(20),
});
export type CopyResult = z.infer<typeof CopyResultSchema>;

// Slide único (regeneração de 1 slide). A IA retorna o objeto do slide direto.
export const SingleSlideResultSchema = z.object({
  slide: SlideSchema,
});
export type SingleSlideResult = z.infer<typeof SingleSlideResultSchema>;
