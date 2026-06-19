import { z } from "zod";

// =========================================================
// Schemas Zod — INPUT do wizard e SAÍDA da IA.
// Toda saída de IA é validada por estes schemas ANTES de persistir.
// =========================================================

// --- INPUT: criar job (POST /api/atomization) ---
export const CreateJobInputSchema = z.object({
  source_url: z.string().url("URL inválida"),
  rights_attested: z.literal(true, {
    message: "É necessário atestar os direitos sobre o vídeo",
  }),
  settings: z
    .object({
      clip_count: z.number().int().min(1).max(10).optional(),
      auto_schedule: z.boolean().optional(),
    })
    .optional()
    .default({}),
});
export type CreateJobInput = z.infer<typeof CreateJobInputSchema>;

// --- SAÍDA DA IA: seleção de clips ---
// A IA retorna { clips: [...] }. Validamos estritamente cada clip.
export const ClipSchema = z
  .object({
    start_seconds: z.number().min(0),
    end_seconds: z.number().min(0),
    hook_text: z.string().min(1).max(300),
    rationale: z.string().min(1).max(600),
    virality_score: z.number().min(0).max(1),
  })
  .refine((c) => c.end_seconds > c.start_seconds, {
    message: "end_seconds deve ser maior que start_seconds",
    path: ["end_seconds"],
  });

export const ClipSelectionSchema = z.object({
  clips: z.array(ClipSchema).min(1).max(10),
});
export type ClipSelection = z.infer<typeof ClipSelectionSchema>;

// --- SAÍDA DA IA: copy dos assets (na voz da marca) ---
export const AssetCopySchema = z.object({
  reel_caption: z.string().min(1).max(2200),
  carousel: z
    .array(z.object({ title: z.string().max(100), body: z.string().max(500) }))
    .min(2)
    .max(10),
  story: z.string().min(1).max(500),
  hashtags: z.array(z.string().regex(/^#?\w+$/)).min(1).max(30),
});
export type AssetCopy = z.infer<typeof AssetCopySchema>;

/**
 * Faz parse seguro de uma string JSON vinda da IA contra um schema.
 * Retorna { ok:true, data } ou { ok:false, error } — nunca lança.
 * Use sempre isto antes de persistir saída de IA.
 */
export function parseAiJson<T>(
  schema: z.ZodType<T>,
  raw: string | null | undefined
): { ok: true; data: T } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Resposta vazia da IA" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "JSON inválido na resposta da IA" };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "Saída da IA inválida" };
  }
  return { ok: true, data: result.data };
}
