import type { SupabaseClient } from "@supabase/supabase-js";

const GENERIC_VOICE =
  "Use um tom profissional, claro e envolvente, adequado a redes sociais.";

/**
 * Retorna a instrução de voz da marca para injetar nos prompts.
 * Lê brand_voice_profiles da org; se não houver perfil, usa um fallback genérico.
 * (A Tarefa 7 expande com tom/exemplares estruturados.)
 */
export async function getVoiceInstruction(
  admin: SupabaseClient,
  organizationId: string
): Promise<string> {
  const { data } = await admin
    .from("brand_voice_profiles")
    .select("summary, tone, exemplars")
    .eq("organization_id", organizationId)
    .is("channel_id", null)
    .maybeSingle();

  if (!data) return GENERIC_VOICE;

  const parts: string[] = [];
  if (data.summary) parts.push(`Voz da marca: ${data.summary}.`);

  const tone = data.tone as Record<string, unknown> | null;
  if (tone && Object.keys(tone).length > 0) {
    parts.push(`Tom: ${JSON.stringify(tone)}.`);
  }

  const exemplars = data.exemplars as unknown[];
  if (Array.isArray(exemplars) && exemplars.length > 0) {
    parts.push(`Exemplos do estilo: ${exemplars.slice(0, 3).map(String).join(" | ")}.`);
  }

  return parts.length > 0 ? parts.join(" ") : GENERIC_VOICE;
}
