import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  admin,
  createTenant,
  seedAllTables,
  cleanup,
  type Tenant,
  type SeededRows,
} from "./helpers/tenancy";

// ============================================================
// Teste de integração: isolamento multi-tenant (RLS) das tabelas dos
// recursos novos (atomization_*, brand_voice_profiles, dm-pilot, approvals,
// workspace_branding). Bate no Supabase REAL.
//
// O teste FALHA se qualquer policy estiver ausente/frouxa: se a org A
// conseguir ler dados da org B, ou se um 'member' conseguir escrever onde só
// admin pode, ou se a rota pública vazar collection de outra org, ou se
// approval_decisions aceitar update/delete por authenticated/anon.
// ============================================================

// Todas as 21 tabelas que devem isolar por organization_id.
const TENANT_TABLES = [
  "brand_voice_profiles",
  "atomization_jobs",
  "atomization_transcripts",
  "atomization_clips",
  "atomization_assets",
  "automation_configs",
  "automation_rules",
  "interaction_events",
  "interaction_actions",
  "conversations",
  "conversation_messages",
  "sales_flows",
  "review_queue",
  "faq_entries",
  "approval_collections",
  "approval_collection_items",
  "approval_links",
  "approval_sessions",
  "approval_decisions",
  "approval_comments",
  "workspace_branding",
] as const;

let A: Tenant;
let B: Tenant;
let memberA: Tenant;
let seedA: SeededRows;
let seedB: SeededRows;
const orgIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  // Org A com owner; org B com owner; + um 'member' na org A (p/ asserção #2).
  A = await createTenant("owner");
  B = await createTenant("owner");
  memberA = await createTenant("member"); // cria nova org; sobrescreveremos a membership
  // memberA precisa ser MEMBER da org A (não da própria). Ajusta a membership.
  const ad = admin();
  await ad.from("organization_members").delete().eq("user_id", memberA.userId);
  await ad
    .from("organization_members")
    .insert({ org_id: A.orgId, user_id: memberA.userId, role: "member" });

  orgIds.push(A.orgId, B.orgId, memberA.orgId);
  userIds.push(A.userId, B.userId, memberA.userId);

  seedA = await seedAllTables(A);
  seedB = await seedAllTables(B);
}, 60_000);

afterAll(async () => {
  await cleanup(orgIds, userIds);
});

describe("1. Isolamento de leitura entre orgs (RLS select)", () => {
  for (const table of TENANT_TABLES) {
    it(`${table}: org A não enxerga linha da org B (e vice-versa)`, async () => {
      const idB = seedB[table as keyof SeededRows] as string;
      const idA = seedA[table as keyof SeededRows] as string;

      // Client de A buscando a linha de B -> deve vir VAZIO.
      const { data: aSeesB, error: e1 } = await A.client.from(table).select("id").eq("id", idB);
      expect(e1, `${table}: erro inesperado ao ler`).toBeNull();
      expect(aSeesB, `${table}: org A NÃO deve ver linha da org B`).toEqual([]);

      // Client de B buscando a linha de A -> deve vir VAZIO.
      const { data: bSeesA } = await B.client.from(table).select("id").eq("id", idA);
      expect(bSeesA, `${table}: org B NÃO deve ver linha da org A`).toEqual([]);

      // Sanidade: A consegue ver a PRÓPRIA linha (senão a policy está zerada
      // por outro motivo e o teste acima passaria por engano).
      const { data: aSeesA } = await A.client.from(table).select("id").eq("id", idA);
      expect(aSeesA?.length, `${table}: org A deve ver a própria linha`).toBe(1);
    });
  }
});

describe("2. 'member' não consegue escrever onde só admin pode", () => {
  it("member NÃO insere em atomization_jobs (RLS insert exige owner/admin)", async () => {
    const { error } = await memberA.client
      .from("atomization_jobs")
      .insert({ organization_id: A.orgId, created_by: memberA.userId, source_url: "https://x.test" });
    // RLS rejeita -> erro (42501 / violação de policy). NÃO pode inserir.
    expect(error, "insert de member deveria ser bloqueado pela RLS").not.toBeNull();
  });

  it("member NÃO atualiza automation_configs (RLS update exige owner/admin)", async () => {
    // O update não deve afetar nenhuma linha (RLS filtra) — confirmamos relendo.
    const { data: updated } = await memberA.client
      .from("automation_configs")
      .update({ kill_switch: true })
      .eq("id", seedA.automation_configs)
      .select("id");
    expect(updated ?? [], "update de member não deve afetar linha alguma").toEqual([]);

    // Confirma via service_role que o valor NÃO mudou.
    const { data: row } = await admin()
      .from("automation_configs")
      .select("kill_switch")
      .eq("id", seedA.automation_configs)
      .single();
    expect(row?.kill_switch, "kill_switch não deveria ter sido alterado por um member").toBe(false);
  });

  it("member CONSEGUE ler (sanidade: é membro da org A)", async () => {
    const { data } = await memberA.client
      .from("automation_configs")
      .select("id")
      .eq("id", seedA.automation_configs);
    expect(data?.length).toBe(1);
  });
});

describe("3. Rota pública: token da org A não alcança collection da org B", () => {
  it("token de A só resolve a collection de A; item de B é inalcançável", async () => {
    const { validateAndLoad } = await import("@/lib/approvals/public-guard");

    // Token válido de A carrega APENAS a collection de A.
    const resA = await validateAndLoad(seedA.publicToken, { touch: false });
    expect(resA.ok, "token de A deveria validar").toBe(true);
    if (resA.ok) {
      expect(resA.data.organization_id).toBe(A.orgId);
      expect(resA.data.collection_id).toBe(seedA.approval_collections);
      // Nenhum item retornado pertence à collection/post da org B.
      const itemIds = resA.data.items.map((i) => i.id);
      expect(itemIds).not.toContain(seedB.approval_collection_items);
      expect(resA.data.organization_id).not.toBe(B.orgId);
    }

    // Defense-in-depth da rota /decide: o escopo manual recusa item de B sob
    // o token de A. Replicamos a query de escopo da rota com o admin client.
    const { data: crossItem } = await admin()
      .from("approval_collection_items")
      .select("id")
      .eq("id", seedB.approval_collection_items)
      .eq("collection_id", seedA.approval_collections) // collection do token de A
      .eq("organization_id", A.orgId)
      .maybeSingle();
    expect(crossItem, "item de B não deve casar com o escopo do token de A").toBeNull();
  });
});

describe("4. approval_decisions é append-only (authenticated/anon)", () => {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  it("authenticated (membro da própria org) NÃO consegue UPDATE", async () => {
    const { data, error } = await A.client
      .from("approval_decisions")
      .update({ decision: "rejected" })
      .eq("id", seedA.approval_decisions)
      .select("id");
    // Sem policy de update + REVOKE -> 0 linhas afetadas ou erro de permissão.
    expect((data ?? []).length === 0 || error !== null, "UPDATE não deveria afetar a decisão").toBe(true);

    const { data: row } = await admin()
      .from("approval_decisions")
      .select("decision")
      .eq("id", seedA.approval_decisions)
      .single();
    expect(row?.decision, "decision não pode ter mudado").toBe("approved");
  });

  it("authenticated NÃO consegue DELETE", async () => {
    await A.client.from("approval_decisions").delete().eq("id", seedA.approval_decisions);
    const { count } = await admin()
      .from("approval_decisions")
      .select("id", { count: "exact", head: true })
      .eq("id", seedA.approval_decisions);
    expect(count, "a decisão deve continuar existindo (delete bloqueado)").toBe(1);
  });

  it("anon NÃO consegue UPDATE nem DELETE", async () => {
    await anon.from("approval_decisions").update({ decision: "rejected" }).eq("id", seedA.approval_decisions);
    await anon.from("approval_decisions").delete().eq("id", seedA.approval_decisions);
    const { data: row } = await admin()
      .from("approval_decisions")
      .select("decision")
      .eq("id", seedA.approval_decisions)
      .single();
    expect(row?.decision, "anon não pode alterar nem remover a decisão").toBe("approved");
  });
});
