import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signToken, hashToken } from "@/lib/approvals/token";

// ============================================================
// Helpers para os testes de isolamento multi-tenant.
//
// - admin(): client service_role (bypassa RLS) — usado p/ semear dados.
// - createTenant(): cria org + usuário membro + client AUTENTICADO real
//   (sessão JWT via signInWithPassword) que será submetido às policies RLS.
// - seedAllTables(): insere 1 linha por tabela carimbando organization_id,
//   montando a cadeia de FKs necessária (channel -> post -> collection ...).
// ============================================================

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function admin(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Tenant = {
  orgId: string;
  userId: string;
  email: string;
  password: string;
  role: "owner" | "admin" | "member";
  /** Client autenticado como este usuário — sujeito a RLS. */
  client: SupabaseClient;
};

// Prefixo p/ identificar e limpar tudo que o teste cria.
export const TEST_TAG = "rlsiso";

let seq = 0;
function uniq(p: string): string {
  seq += 1;
  // Sem Math.random/Date.now em produção, mas em teste é ok; usamos pid+seq.
  return `${TEST_TAG}-${p}-${process.pid}-${seq}`;
}

/** Cria org + usuário (com `role`) + client autenticado real. */
export async function createTenant(role: "owner" | "admin" | "member"): Promise<Tenant> {
  const a = admin();

  // Usuário primeiro: organizations.created_by é NOT NULL (autoria).
  const email = `${uniq("user")}@example.test`;
  const password = "Test-Password-123!";
  const { data: created, error: userErr } = await a.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) throw new Error(`createTenant user: ${userErr?.message}`);
  const userId = created.user.id;

  const { data: org, error: orgErr } = await a
    .from("organizations")
    .insert({ name: uniq("org"), type: "team", created_by: userId })
    .select("id")
    .single();
  if (orgErr) throw new Error(`createTenant org: ${orgErr.message}`);

  const { error: memErr } = await a
    .from("organization_members")
    .insert({ org_id: org.id, user_id: userId, role });
  if (memErr) throw new Error(`createTenant membership: ${memErr.message}`);

  // Sessão real: um client anon que faz login -> RLS enxerga auth.uid().
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`createTenant signIn: ${signErr.message}`);

  return { orgId: org.id, userId, email, password, role, client };
}

// IDs das linhas semeadas por tabela, para conferência por org.
export type SeededRows = {
  brand_voice_profiles: string;
  atomization_jobs: string;
  atomization_transcripts: string;
  atomization_clips: string;
  atomization_assets: string;
  automation_configs: string;
  automation_rules: string;
  interaction_events: string;
  interaction_actions: string;
  conversations: string;
  conversation_messages: string;
  sales_flows: string;
  review_queue: string;
  faq_entries: string;
  approval_collections: string;
  approval_collection_items: string;
  approval_links: string;
  approval_sessions: string;
  approval_decisions: string;
  approval_comments: string;
  workspace_branding: string;
  // suporte (não asseridas diretamente, mas necessárias p/ FKs)
  channelId: string;
  postId: string;
  /** token público válido p/ a collection desta org. */
  publicToken: string;
};

async function ins(
  a: SupabaseClient,
  table: string,
  row: Record<string, unknown>
): Promise<string> {
  const { data, error } = await a.from(table).insert(row).select("id").single();
  if (error) throw new Error(`seed ${table}: ${error.message}`);
  return data.id as string;
}

/** Insere 1 linha em cada tabela-alvo, carimbando organization_id da org. */
export async function seedAllTables(t: Tenant): Promise<SeededRows> {
  const a = admin();
  const org = t.orgId;

  // --- cadeia de suporte: channel -> scheduled_post ---
  const { data: ct } = await a
    .from("channel_types")
    .select("id")
    .eq("type", "INSTAGRAM")
    .limit(1)
    .single();

  const channelId = await ins(a, "user_channels", {
    user_id: t.userId,
    org_id: org,
    channel_type_id: ct!.id,
    handle: `${TEST_TAG}_${t.orgId.slice(0, 8)}`,
    provider_account_id: `${TEST_TAG}_${t.orgId.slice(0, 8)}`,
  });

  const postId = await ins(a, "scheduled_posts", {
    user_id: t.userId,
    org_id: org,
    user_channel_id: channelId,
    content: `${TEST_TAG} post`,
    scheduled_at: "2030-01-01T00:00:00Z",
    status: "draft",
  });

  // --- atomization_* + brand_voice ---
  const brand_voice_profiles = await ins(a, "brand_voice_profiles", {
    organization_id: org,
    channel_id: channelId,
    summary: `${TEST_TAG} voz`,
  });
  const atomization_jobs = await ins(a, "atomization_jobs", {
    organization_id: org,
    created_by: t.userId,
    source_url: "https://youtu.be/test",
    status: "queued",
  });
  const atomization_transcripts = await ins(a, "atomization_transcripts", {
    organization_id: org,
    job_id: atomization_jobs,
    full_text: `${TEST_TAG} transcript`,
  });
  const atomization_clips = await ins(a, "atomization_clips", {
    organization_id: org,
    job_id: atomization_jobs,
    clip_index: 0,
    start_seconds: 0,
    end_seconds: 10,
  });
  const atomization_assets = await ins(a, "atomization_assets", {
    organization_id: org,
    clip_id: atomization_clips,
    asset_type: "reel_caption",
  });

  // --- dm-pilot ---
  const automation_configs = await ins(a, "automation_configs", {
    organization_id: org,
    channel_id: channelId,
  });
  const automation_rules = await ins(a, "automation_rules", {
    organization_id: org,
    channel_id: channelId,
    intent: "purchase",
    action_type: "public_reply",
  });
  const interaction_events = await ins(a, "interaction_events", {
    organization_id: org,
    channel_id: channelId,
    provider: "instagram",
    provider_event_id: uniq("evt"),
    type: "comment",
    text: `${TEST_TAG} evt`,
  });
  const interaction_actions = await ins(a, "interaction_actions", {
    event_id: interaction_events,
    organization_id: org,
    action_type: "public_reply",
  });
  const conversations = await ins(a, "conversations", {
    organization_id: org,
    channel_id: channelId,
    external_user_id: uniq("ext"),
  });
  const conversation_messages = await ins(a, "conversation_messages", {
    conversation_id: conversations,
    organization_id: org,
    direction: "in",
    text: `${TEST_TAG} msg`,
  });
  const sales_flows = await ins(a, "sales_flows", {
    organization_id: org,
    name: `${TEST_TAG} flow`,
  });
  const review_queue = await ins(a, "review_queue", {
    organization_id: org,
    event_id: interaction_events,
  });
  const faq_entries = await ins(a, "faq_entries", {
    organization_id: org,
    question: `${TEST_TAG}?`,
    answer: `${TEST_TAG}.`,
  });

  // --- approvals + branding ---
  const approval_collections = await ins(a, "approval_collections", {
    organization_id: org,
    created_by: t.userId,
    client_name: `${TEST_TAG} client`,
    title: `${TEST_TAG} title`,
  });
  const approval_collection_items = await ins(a, "approval_collection_items", {
    collection_id: approval_collections,
    organization_id: org,
    post_id: postId,
  });

  // link com token público válido
  const linkId = crypto.randomUUID();
  const rawToken = signToken({
    link_id: linkId,
    collection_id: approval_collections,
    scope: {},
    expiresInMs: 3600_000,
  });
  const approval_links = await ins(a, "approval_links", {
    id: linkId,
    collection_id: approval_collections,
    organization_id: org,
    token_hash: hashToken(rawToken),
    expires_at: "2030-01-01T00:00:00Z",
    created_by: t.userId,
  });
  const approval_sessions = await ins(a, "approval_sessions", {
    link_id: approval_links,
    organization_id: org,
    external_email: `${TEST_TAG}@example.test`,
  });
  const approval_decisions = await ins(a, "approval_decisions", {
    collection_item_id: approval_collection_items,
    collection_id: approval_collections,
    organization_id: org,
    decision: "approved",
  });
  const approval_comments = await ins(a, "approval_comments", {
    collection_item_id: approval_collection_items,
    organization_id: org,
    author_type: "client",
    body: `${TEST_TAG} comment`,
  });
  const workspace_branding = await ins(a, "workspace_branding", {
    organization_id: org,
    email_from_name: `${TEST_TAG}`,
  });

  return {
    brand_voice_profiles,
    atomization_jobs,
    atomization_transcripts,
    atomization_clips,
    atomization_assets,
    automation_configs,
    automation_rules,
    interaction_events,
    interaction_actions,
    conversations,
    conversation_messages,
    sales_flows,
    review_queue,
    faq_entries,
    approval_collections,
    approval_collection_items,
    approval_links,
    approval_sessions,
    approval_decisions,
    approval_comments,
    workspace_branding,
    channelId,
    postId,
    publicToken: rawToken,
  };
}

/** Remove tudo que o teste criou (orgs com cascade derrubam quase tudo). */
export async function cleanup(orgIds: string[], userIds: string[]): Promise<void> {
  const a = admin();
  for (const orgId of orgIds) {
    await a.from("organizations").delete().eq("id", orgId); // cascade
  }
  for (const userId of userIds) {
    await a.auth.admin.deleteUser(userId).catch(() => {});
  }
}
