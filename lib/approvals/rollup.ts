import { getSupabaseAdminClient } from "@/lib/supabase-server";
import type { CollectionStatus, ItemStatus } from "@/types/approvals";

/**
 * Recalcula o status da coleção a partir dos status dos itens.
 * Regras:
 *  - sem itens                          -> 'draft'
 *  - todos 'approved'                   -> 'approved'
 *  - algum 'rejected'                   -> 'changes_requested'
 *  - algum 'changes_requested'          -> 'changes_requested'
 *  - caso contrário (há 'pending')      -> 'in_review'
 * Não mexe em coleções 'archived'.
 */
export function deriveCollectionStatus(itemStatuses: ItemStatus[]): CollectionStatus {
  if (itemStatuses.length === 0) return "draft";
  if (itemStatuses.every((s) => s === "approved")) return "approved";
  if (itemStatuses.some((s) => s === "rejected" || s === "changes_requested")) {
    return "changes_requested";
  }
  return "in_review";
}

export async function recomputeCollectionStatus(collectionId: string): Promise<CollectionStatus | null> {
  const admin = getSupabaseAdminClient();

  const { data: coll } = await admin
    .from("approval_collections")
    .select("id, status")
    .eq("id", collectionId)
    .maybeSingle();
  if (!coll) return null;
  if (coll.status === "archived") return "archived";

  const { data: items } = await admin
    .from("approval_collection_items")
    .select("item_status")
    .eq("collection_id", collectionId);

  const next = deriveCollectionStatus(
    (items ?? []).map((i) => i.item_status as ItemStatus)
  );

  if (next !== coll.status) {
    await admin
      .from("approval_collections")
      .update({ status: next })
      .eq("id", collectionId);
  }
  return next;
}
