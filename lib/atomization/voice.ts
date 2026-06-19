import type { SupabaseClient } from "@supabase/supabase-js";

const GENERIC_VOICE =
  "Use um tom profissional, claro e envolvente, adequado a redes sociais.";

// Limita o tamanho dos exemplares injetados no prompt (evita estourar tokens).
const MAX_EXEMPLARS = 3;
const MAX_EXEMPLAR_LEN = 280;

type BrandVoiceRow = {
  summary: string | null;
  tone: unknown;
  exemplars: unknown;
};

/**
 * Retorna a instrução de voz da marca para injetar nos prompts de copy.
 *
 * Estratégia de seleção do perfil (mais específico primeiro):
 *   1. perfil do canal (se `channelId` informado) →
 *   2. perfil geral da org (channel_id null) →
 *   3. fallback genérico.
 *
 * Lê `brand_voice_profiles` e converte `summary`/`tone`/`exemplars` em uma
 * instrução em linguagem natural. Nunca lança: qualquer dado ausente ou
 * malformado degrada para o fallback genérico.
 */
export async function getVoiceInstruction(
  admin: SupabaseClient,
  organizationId: string,
  channelId?: string | null
): Promise<string> {
  const profile = await loadProfile(admin, organizationId, channelId);
  if (!profile) return GENERIC_VOICE;

  const instruction = buildInstruction(profile);
  return instruction || GENERIC_VOICE;
}

/**
 * Carrega o perfil mais específico disponível: tenta o do canal e, se não
 * existir, cai para o perfil geral da org (channel_id null).
 */
async function loadProfile(
  admin: SupabaseClient,
  organizationId: string,
  channelId?: string | null
): Promise<BrandVoiceRow | null> {
  if (channelId) {
    const { data } = await admin
      .from("brand_voice_profiles")
      .select("summary, tone, exemplars")
      .eq("organization_id", organizationId)
      .eq("channel_id", channelId)
      .maybeSingle();
    if (data) return data as BrandVoiceRow;
  }

  const { data } = await admin
    .from("brand_voice_profiles")
    .select("summary, tone, exemplars")
    .eq("organization_id", organizationId)
    .is("channel_id", null)
    .maybeSingle();

  return (data as BrandVoiceRow | null) ?? null;
}

/** Monta a instrução textual a partir das partes do perfil. */
function buildInstruction(profile: BrandVoiceRow): string {
  const parts: string[] = [];

  const summary = typeof profile.summary === "string" ? profile.summary.trim() : "";
  if (summary) parts.push(`Voz da marca: ${summary}`);

  const tone = renderTone(profile.tone);
  if (tone) parts.push(`Tom desejado: ${tone}`);

  const exemplars = renderExemplars(profile.exemplars);
  if (exemplars) {
    parts.push(
      `Imite o estilo destes exemplos (sem copiar literalmente):\n${exemplars}`
    );
  }

  return parts.join("\n");
}

/**
 * Converte `tone` em texto. Aceita:
 *  - array de strings: ["descontraído","direto"] → "descontraído, direto"
 *  - objeto traço→valor: {formalidade:"baixa",humor:"alto"} →
 *      "formalidade: baixa; humor: alto"
 *  - string já pronta.
 */
function renderTone(tone: unknown): string {
  if (!tone) return "";
  if (typeof tone === "string") return tone.trim();

  if (Array.isArray(tone)) {
    return tone
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => (v as string).trim())
      .join(", ");
  }

  if (typeof tone === "object") {
    const entries = Object.entries(tone as Record<string, unknown>).filter(
      ([, v]) => v != null && String(v).trim()
    );
    return entries.map(([k, v]) => `${k}: ${String(v).trim()}`).join("; ");
  }

  return "";
}

/**
 * Converte `exemplars` numa lista com marcadores. Aceita array de strings ou
 * de objetos {text|caption|content}. Limita quantidade e tamanho.
 */
function renderExemplars(exemplars: unknown): string {
  if (!Array.isArray(exemplars)) return "";

  const texts = exemplars
    .map((e) => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        const o = e as Record<string, unknown>;
        const t = o.text ?? o.caption ?? o.content ?? o.body;
        return typeof t === "string" ? t : "";
      }
      return "";
    })
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_EXEMPLARS)
    .map((t) => (t.length > MAX_EXEMPLAR_LEN ? t.slice(0, MAX_EXEMPLAR_LEN) + "…" : t));

  return texts.map((t) => `- ${t}`).join("\n");
}
