import type { SupabaseClient } from "@supabase/supabase-js";
import { getVoiceInstruction } from "@/lib/atomization/voice";

// ============================================================
// Voz da marca para as respostas do DM Pilot.
//
// Reusa o seletor de perfil da Atomização (brand_profiles, colunas voice_*):
// canal mais específico -> org -> fallback genérico. Aqui só damos um ponto de
// entrada nomeado para o recurso e deixamos espaço para preferir um
// brand_voice_id explícito vindo de automation_configs.
// ============================================================

/**
 * Instrução de voz para o DM Pilot. Se `channelId` informado, usa o perfil do
 * canal; senão o geral da org. Nunca lança (degrada p/ genérico).
 */
export async function getDmPilotVoice(
  admin: SupabaseClient,
  organizationId: string,
  channelId?: string | null
): Promise<string> {
  return getVoiceInstruction(admin, organizationId, channelId);
}
