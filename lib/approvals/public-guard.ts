import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { verifyToken, hashToken } from "@/lib/approvals/token";
import type {
  ApprovalCollection,
  ApprovalCollectionItem,
  WorkspaceBranding,
} from "@/types/approvals";

// Dado escopado carregado para a página pública.
export type PublicApprovalData = {
  link_id: string;
  collection_id: string;
  organization_id: string;
  collection: Pick<ApprovalCollection, "id" | "client_name" | "title" | "status" | "due_at">;
  items: (Pick<ApprovalCollectionItem, "id" | "post_id" | "position" | "item_status"> & {
    post: {
      content: string;
      images: unknown;
      scheduled_at: string | null;
      channel: { type: string; name: string; color: string } | null;
    };
    comments: { id: string; author_type: string; body: string; created_at: string }[];
  })[];
  branding: Pick<
    WorkspaceBranding,
    "logo_path" | "primary_color" | "accent_color" | "email_from_name"
  >;
  logoUrl: string | null;
};

export type GuardResult =
  | { ok: true; data: PublicApprovalData }
  | { ok: false };

const INVALID: GuardResult = { ok: false };

/**
 * Validação completa do token público + carregamento escopado.
 *
 * Ordem (invariante 3): assinatura -> hash -> busca por hash -> revoked/expires/max_uses.
 * Qualquer falha => { ok:false } genérico (anti-enumeração; nunca revela a coleção).
 *
 * Usa o ADMIN client (service_role, sem sessão). TODAS as queries são escopadas
 * ao collection_id/organization_id do LINK encontrado no banco — nunca a valores
 * vindos do corpo da request.
 *
 * `touch` (default true) incrementa used_count e cria a sessão. Em chamadas só de
 * leitura repetidas (re-render), passe touch=false.
 */
export async function validateAndLoad(
  token: string | undefined,
  opts?: { ip?: string | null; userAgent?: string | null; touch?: boolean }
): Promise<GuardResult> {
  // 1. Assinatura + expiração do token (não toca o banco ainda).
  const verified = verifyToken(token);
  if (!verified.ok) return INVALID;

  const admin = getSupabaseAdminClient();

  // 2. Hash -> 3. busca o link pelo hash.
  const tokenHash = hashToken(token as string);
  const { data: link } = await admin
    .from("approval_links")
    .select("id, collection_id, organization_id, expires_at, revoked_at, max_uses, used_count")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!link) return INVALID;

  // 4. Checagens de estado do link.
  if (link.revoked_at) return INVALID;
  if (new Date(link.expires_at).getTime() < Date.now()) return INVALID;
  if (link.max_uses != null && link.used_count >= link.max_uses) return INVALID;

  // Defense-in-depth: o collection_id do payload assinado deve bater com o do banco.
  if (verified.payload.collection_id !== link.collection_id) return INVALID;

  const collectionId = link.collection_id;
  const organizationId = link.organization_id;

  // 5. Carrega dados ESCOPADOS ao collection_id/org do link real.
  const { data: collection } = await admin
    .from("approval_collections")
    .select("id, client_name, title, status, due_at")
    .eq("id", collectionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!collection) return INVALID;

  const { data: items } = await admin
    .from("approval_collection_items")
    .select(
      "id, post_id, position, item_status, scheduled_posts(content, images, scheduled_at, user_channels(channel_types(type, name, color)))"
    )
    .eq("collection_id", collectionId)
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });

  const itemIds = (items ?? []).map((i) => i.id);
  const { data: comments } = itemIds.length
    ? await admin
        .from("approval_comments")
        .select("id, collection_item_id, author_type, body, created_at")
        .in("collection_item_id", itemIds)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true })
    : { data: [] as { id: string; collection_item_id: string; author_type: string; body: string; created_at: string }[] };

  const { data: branding } = await admin
    .from("workspace_branding")
    .select("logo_path, primary_color, accent_color, email_from_name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // URL pública do logo (se houver), via storage público.
  let logoUrl: string | null = null;
  if (branding?.logo_path) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "flow-insta";
    const { data: pub } = admin.storage.from(bucket).getPublicUrl(branding.logo_path);
    logoUrl = pub.publicUrl;
  }

  // 6. (opcional) registra sessão e incrementa used_count.
  const touch = opts?.touch !== false;
  if (touch) {
    await admin.from("approval_sessions").insert({
      link_id: link.id,
      organization_id: organizationId,
      ip: opts?.ip ?? null,
      user_agent: opts?.userAgent ?? null,
    });
    await admin
      .from("approval_links")
      .update({ used_count: link.used_count + 1 })
      .eq("id", link.id);
  }

  const mappedItems = (items ?? []).map((it) => {
    const sp = it.scheduled_posts as unknown as {
      content?: string;
      images?: unknown;
      scheduled_at?: string | null;
      user_channels?: { channel_types?: { type?: string; name?: string; color?: string } };
    } | null;
    const ct = sp?.user_channels?.channel_types;
    return {
      id: it.id,
      post_id: it.post_id,
      position: it.position,
      item_status: it.item_status,
      post: {
        content: sp?.content ?? "",
        images: sp?.images ?? [],
        scheduled_at: sp?.scheduled_at ?? null,
        channel: ct ? { type: ct.type ?? "", name: ct.name ?? "", color: ct.color ?? "#999999" } : null,
      },
      comments: (comments ?? [])
        .filter((c) => c.collection_item_id === it.id)
        .map((c) => ({ id: c.id, author_type: c.author_type, body: c.body, created_at: c.created_at })),
    };
  });

  return {
    ok: true,
    data: {
      link_id: link.id,
      collection_id: collectionId,
      organization_id: organizationId,
      collection,
      items: mappedItems,
      branding: {
        logo_path: branding?.logo_path ?? null,
        primary_color: branding?.primary_color ?? "#6366f1",
        accent_color: branding?.accent_color ?? "#06b6d4",
        email_from_name: branding?.email_from_name ?? null,
      },
      logoUrl,
    },
  };
}

/**
 * Variante somente-leitura usada pelas APIs decide/comment: valida o token e
 * retorna o link_id/collection_id/org sem recarregar tudo nem incrementar uso.
 * Retorna null em qualquer falha.
 */
export async function validateTokenOnly(
  token: string | undefined
): Promise<{ link_id: string; collection_id: string; organization_id: string } | null> {
  const verified = verifyToken(token);
  if (!verified.ok) return null;

  const admin = getSupabaseAdminClient();
  const { data: link } = await admin
    .from("approval_links")
    .select("id, collection_id, organization_id, expires_at, revoked_at, max_uses, used_count")
    .eq("token_hash", hashToken(token as string))
    .maybeSingle();

  if (!link) return null;
  if (link.revoked_at) return null;
  if (new Date(link.expires_at).getTime() < Date.now()) return null;
  if (link.max_uses != null && link.used_count >= link.max_uses) return null;
  if (verified.payload.collection_id !== link.collection_id) return null;

  return {
    link_id: link.id,
    collection_id: link.collection_id,
    organization_id: link.organization_id,
  };
}
