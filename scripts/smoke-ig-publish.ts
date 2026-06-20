/**
 * Smoke test da Fase 3 (sem Graph real — não há canal IG conectado).
 *
 * Prova:
 *   1. inferMediaType: 1 mídia -> image; 2+ -> carousel.
 *   2. publishInstagramPost falha LIMPO sem igUserId/mídia (sem crash).
 *   3. IDEMPOTÊNCIA DO CLAIM: claim_due_posts move 'queue'->'publishing' e uma
 *      2ª chamada NÃO repega o mesmo post (duas instâncias não publicam 2x).
 *
 * A chamada real à Graph (container->FINISHED->publish) só é testável quando um
 * canal Instagram for conectado (user_channels com token). Aqui validamos a
 * máquina de claim/gate, que é o que garante segurança de concorrência.
 *
 * Uso: env -u SUPABASE_ACCESS_TOKEN npx tsx scripts/smoke-ig-publish.ts
 */
import "dotenv/config";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { inferMediaType, publishInstagramPost } from "@/lib/meta/publish";

const TAG = "[smoke-ig]";

async function main() {
  let ok = true;

  // 1. inferMediaType
  console.log(`${TAG} == 1. inferMediaType ==`);
  const a = inferMediaType(["u1"]) === "image";
  const b = inferMediaType(["u1", "u2"]) === "carousel";
  console.log(`  ${a ? "✓" : "✗"} 1 mídia -> image`);
  console.log(`  ${b ? "✓" : "✗"} 2 mídias -> carousel`);
  ok = ok && a && b;

  // 2. falha limpa sem igUserId / sem mídia (não lança)
  console.log(`${TAG} == 2. falha limpa (sem token real) ==`);
  const noUser = await publishInstagramPost({
    token: "FAKE",
    igUserId: "",
    mediaType: "image",
    caption: "x",
    mediaUrls: ["u1"],
  });
  const r2a = noUser.ok === false && /provider_account_id|account id/i.test(noUser.error);
  console.log(`  ${r2a ? "✓" : "✗"} sem igUserId -> erro legível (got: ${noUser.ok ? "ok" : noUser.error})`);
  const noMedia = await publishInstagramPost({
    token: "FAKE",
    igUserId: "123",
    mediaType: "image",
    caption: "x",
    mediaUrls: [],
  });
  const r2b = noMedia.ok === false && /mídia/i.test(noMedia.error);
  console.log(`  ${r2b ? "✓" : "✗"} sem mídia -> erro legível (got: ${noMedia.ok ? "ok" : noMedia.error})`);
  ok = ok && r2a && r2b;

  // 3. idempotência do claim_due_posts
  console.log(`${TAG} == 3. claim idempotente (2 instâncias) ==`);
  const admin = getSupabaseAdminClient();
  const { data: member } = await admin
    .from("organization_members")
    .select("org_id, user_id")
    .limit(1)
    .maybeSingle();
  if (!member) throw new Error("sem organization_members para o teste");

  // Cria um post 'queue' vencido (scheduled_at no passado), sem canal (o claim
  // só move o status; a publicação real é outra etapa).
  const { data: post, error: pErr } = await admin
    .from("scheduled_posts")
    .insert({
      org_id: member.org_id,
      user_id: member.user_id,
      content: `${TAG} post de teste de claim`,
      images: [],
      scheduled_at: "2020-01-01T00:00:00Z",
      status: "queue",
    })
    .select("id")
    .single();
  if (pErr || !post) throw new Error(`criar post: ${pErr?.message}`);
  const postId = post.id as string;

  try {
    // 1ª chamada: deve reivindicar (mover para 'publishing').
    const { data: c1 } = await admin.rpc("claim_due_posts", { p_limit: 50, p_lease: "5 minutes" });
    const claimed1 = (c1 ?? []).some((p: { id: string }) => p.id === postId);
    console.log(`  ${claimed1 ? "✓" : "✗"} 1ª chamada reivindica o post`);
    ok = ok && claimed1;

    // 2ª chamada imediata: NÃO deve repegar (já está 'publishing', dentro do lease).
    const { data: c2 } = await admin.rpc("claim_due_posts", { p_limit: 50, p_lease: "5 minutes" });
    const claimed2 = (c2 ?? []).some((p: { id: string }) => p.id === postId);
    console.log(`  ${!claimed2 ? "✓" : "✗"} 2ª chamada NÃO repega (sem dupla publicação)`);
    ok = ok && !claimed2;

    // Confere o status final.
    const { data: after } = await admin
      .from("scheduled_posts")
      .select("status")
      .eq("id", postId)
      .maybeSingle();
    const isPublishing = after?.status === "publishing";
    console.log(`  ${isPublishing ? "✓" : "✗"} status = 'publishing' após o claim`);
    ok = ok && isPublishing;
  } finally {
    await admin.from("scheduled_posts").delete().eq("id", postId);
    console.log(`${TAG} limpeza concluída (post ${postId} removido)`);
  }

  console.log(ok ? `\n${TAG} SMOKE TEST PASSOU ✓` : `\n${TAG} SMOKE TEST FALHOU ✗`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`${TAG} ERRO inesperado:`, e);
  process.exit(1);
});
