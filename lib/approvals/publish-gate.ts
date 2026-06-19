import { getSupabaseAdminClient } from "@/lib/supabase-server";

export type PublishGateResult = {
  allowed: boolean;
  reason: "no_collection" | "approved" | "awaiting_approval";
};

/**
 * Gate de publicação para o pipeline do Inngest.
 *
 * Regra:
 *  - Post NÃO está em nenhuma coleção de aprovação  -> publica (allowed:true, no_collection)
 *  - Post está em item(s) de coleção:
 *      - se ALGUM item ativo (coleção não arquivada) tiver item_status != 'approved'
 *        -> NÃO publica (allowed:false, awaiting_approval)
 *      - se todos os itens relevantes estão 'approved' -> publica (allowed:true, approved)
 *
 * Usa admin client (service_role) — chamado de dentro do job (server-only).
 * Em caso de erro inesperado, retorna allowed:false (fail-safe: não publica sem
 * confirmar aprovação).
 */
export async function canPublish(postId: string): Promise<PublishGateResult> {
  try {
    const admin = getSupabaseAdminClient();

    const { data: items, error } = await admin
      .from("approval_collection_items")
      .select("item_status, approval_collections(status)")
      .eq("post_id", postId);

    if (error) {
      console.error("publish-gate query error:", error);
      return { allowed: false, reason: "awaiting_approval" };
    }

    // Considera apenas itens de coleções não arquivadas.
    const active = (items ?? []).filter((it) => {
      const coll = it.approval_collections as unknown as { status?: string } | null;
      return coll?.status !== "archived";
    });

    if (active.length === 0) {
      return { allowed: true, reason: "no_collection" };
    }

    const allApproved = active.every((it) => it.item_status === "approved");
    return allApproved
      ? { allowed: true, reason: "approved" }
      : { allowed: false, reason: "awaiting_approval" };
  } catch (e) {
    console.error("publish-gate unexpected error:", e);
    return { allowed: false, reason: "awaiting_approval" };
  }
}
