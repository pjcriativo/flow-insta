// =========================================================
// Tipos do recurso "Aprovação de Agência" (Client Approval)
// =========================================================

export type CollectionStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "changes_requested"
  | "archived";

export type ItemStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected";

export type DecisionType = "approved" | "changes_requested" | "rejected";

export type CommentAuthorType = "client" | "agency";

// Escopo opcional embutido no token (ex.: limitar a certos itens). Vazio = coleção toda.
export type ApprovalScope = {
  itemIds?: string[];
};

// Payload assinado no magic link (HMAC). NUNCA inclui dados sensíveis.
export type ApprovalTokenPayload = {
  link_id: string;
  collection_id: string;
  scope: ApprovalScope;
  exp: number; // epoch ms
};

// Resultado da validação do token (discriminated union, genérico no erro).
export type TokenVerifyResult =
  | { ok: true; payload: ApprovalTokenPayload }
  | { ok: false };

// --- Linhas do banco (subconjuntos usados na UI) ---

export type ApprovalCollection = {
  id: string;
  organization_id: string;
  created_by: string;
  client_name: string;
  title: string;
  status: CollectionStatus;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalCollectionItem = {
  id: string;
  collection_id: string;
  organization_id: string;
  post_id: string;
  position: number;
  item_status: ItemStatus;
  created_at: string;
};

export type ApprovalLink = {
  id: string;
  collection_id: string;
  organization_id: string;
  token_hash: string;
  scope: ApprovalScope;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number | null;
  used_count: number;
  created_by: string;
  created_at: string;
};

export type WorkspaceBranding = {
  id: string;
  organization_id: string;
  logo_path: string | null;
  primary_color: string | null;
  accent_color: string | null;
  custom_domain: string | null;
  domain_verified: boolean;
  email_from_name: string | null;
};
