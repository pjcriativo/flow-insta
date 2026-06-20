import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { decrypt } from "@/lib/encryption";

// ============================================================
// Acesso ao token do canal para chamadas à Meta.
//
// INVARIANTE #7: o token é descriptografado (CHANNEL_TOKEN_ENCRYPTION_KEY) só
// na BORDA da chamada à Meta — nunca em log nem em erro de API. Este módulo é
// o único ponto onde o token em claro existe; o client (client.ts) recebe o
// token já decriptado e jamais o coloca em mensagem de erro.
// ============================================================

export type ChannelToken = {
  channelId: string;
  organizationId: string;
  providerAccountId: string | null;
  /** Token em claro — usar e descartar; nunca logar. */
  accessToken: string;
};

/**
 * Carrega e descriptografa o access_token de um canal (user_channels), só na
 * borda da chamada. Retorna null se o canal não existe ou não tem token —
 * SEM nunca expor o valor do token na ausência/erro.
 */
export async function getChannelToken(channelId: string): Promise<ChannelToken | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("user_channels")
    .select("id, org_id, provider_account_id, access_token")
    .eq("id", channelId)
    .maybeSingle();

  if (error) {
    console.error("[meta/tokens] erro ao carregar canal", error.message);
    return null;
  }
  if (!data || !data.org_id) return null;

  const accessToken = decrypt(data.access_token);
  if (!accessToken) return null;

  return {
    channelId: data.id,
    organizationId: data.org_id,
    providerAccountId: data.provider_account_id ?? null,
    accessToken,
  };
}
