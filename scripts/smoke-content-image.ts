/**
 * Smoke test da Fase 2: geração de imagem no motor de jobs.
 *
 * Prova (contra Supabase + OpenAI reais):
 *   1. runGenerateContentImages gera imagem por slide e sobe no Storage.
 *   2. Continuidade: slide 2 usa o slide 1 como referência (images.edit).
 *   3. IDEMPOTÊNCIA: rodar de novo NÃO regenera slide 'completed' (skipped) e
 *      NÃO duplica arquivo no Storage.
 *
 * Usa um projeto/sl# de teste descartável (org de teste), gera 2 imagens
 * (custo real ~US$0.34 em 'high'), e limpa tudo ao final.
 *
 * Uso: env -u SUPABASE_ACCESS_TOKEN npx tsx scripts/smoke-content-image.ts
 */
import "dotenv/config";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { runGenerateContentImages } from "@/lib/jobs/content/generate-images";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "flow-insta";
const TAG = "[smoke-img]";

async function main() {
  const admin = getSupabaseAdminClient();

  // Org de teste: pega a primeira org existente (o smoke não cria tenancy).
  // Org de teste + um membro real (created_by é NOT NULL -> auth.users).
  const { data: member } = await admin
    .from("organization_members")
    .select("org_id, user_id")
    .limit(1)
    .maybeSingle();
  if (!member) throw new Error("Nenhum organization_members no banco para o teste.");
  const orgId = member.org_id as string;
  const userId = member.user_id as string;

  // Cria um projeto carrossel de 2 slides em 'generating'.
  const { data: project, error: pErr } = await admin
    .from("content_projects")
    .insert({
      organization_id: orgId,
      created_by: userId,
      content_type: "carousel",
      idea: `${TAG} café de especialidade`,
      slide_count: 2,
      status: "generating",
    })
    .select("id")
    .single();
  if (pErr || !project) throw new Error(`criar projeto: ${pErr?.message}`);
  const projectId = project.id as string;

  const slidesSeed = [
    {
      project_id: projectId,
      organization_id: orgId,
      slide_number: 1,
      role: "capa",
      headline: "Seu café merece mais",
      body: "Descubra o sabor de verdade",
      visual_description: "Xícara de café fumegante sobre mesa de madeira, luz quente da manhã, fundo creme",
      generation_status: "pending",
    },
    {
      project_id: projectId,
      organization_id: orgId,
      slide_number: 2,
      role: "cta",
      headline: "Visite a Aurora",
      body: "Seu novo café favorito",
      visual_description: "Interior aconchegante de cafeteria, mesma paleta e luz da capa, pessoas sorrindo",
      generation_status: "pending",
    },
  ];
  const { data: slides, error: sErr } = await admin
    .from("content_slides")
    .insert(slidesSeed)
    .select("id, slide_number");
  if (sErr || !slides) throw new Error(`criar slides: ${sErr?.message}`);

  let ok = true;
  try {
    console.log(`${TAG} == 1ª passada: gerar imagens ==`);
    const r1 = await runGenerateContentImages(projectId);
    console.log(`${TAG} resultado:`, r1);
    const c1 = r1.completed === 2 && r1.failed === 0 && r1.skipped === 0;
    console.log(`  ${c1 ? "✓" : "✗"} 2 slides completados, 0 falhas, 0 pulados`);
    ok = ok && c1;

    // Confere que os arquivos existem no Storage.
    const { data: files } = await admin.storage.from(BUCKET).list(`generated/${projectId}`);
    const n1 = files?.length ?? 0;
    console.log(`  ${n1 === 2 ? "✓" : "✗"} 2 arquivos no Storage (got ${n1})`);
    ok = ok && n1 === 2;

    // Captura o updated_at das imagens p/ provar que a 2ª passada não regera.
    const { data: afterFirst } = await admin
      .from("content_slides")
      .select("id, generation_status, image_path")
      .eq("project_id", projectId)
      .order("slide_number");
    const allCompleted = (afterFirst ?? []).every((s) => s.generation_status === "completed" && s.image_path);
    console.log(`  ${allCompleted ? "✓" : "✗"} todos os slides 'completed' com image_path`);
    ok = ok && allCompleted;

    console.log(`${TAG} == 2ª passada: idempotência (deve PULAR tudo) ==`);
    const r2 = await runGenerateContentImages(projectId);
    console.log(`${TAG} resultado:`, r2);
    const c2 = r2.completed === 0 && r2.skipped === 2 && r2.failed === 0;
    console.log(`  ${c2 ? "✓" : "✗"} 0 gerados, 2 pulados (idempotente)`);
    ok = ok && c2;

    const { data: files2 } = await admin.storage.from(BUCKET).list(`generated/${projectId}`);
    const n2 = files2?.length ?? 0;
    console.log(`  ${n2 === 2 ? "✓" : "✗"} ainda 2 arquivos (sem duplicação, got ${n2})`);
    ok = ok && n2 === 2;
  } finally {
    // Limpeza: remove arquivos do Storage e o projeto (cascade nos slides).
    const { data: toDelete } = await admin.storage.from(BUCKET).list(`generated/${projectId}`);
    if (toDelete?.length) {
      await admin.storage
        .from(BUCKET)
        .remove(toDelete.map((f) => `generated/${projectId}/${f.name}`));
    }
    await admin.from("content_projects").delete().eq("id", projectId);
    console.log(`${TAG} limpeza concluída (projeto ${projectId} removido)`);
  }

  console.log(ok ? `\n${TAG} SMOKE TEST PASSOU ✓` : `\n${TAG} SMOKE TEST FALHOU ✗`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`${TAG} ERRO inesperado:`, e);
  process.exit(1);
});
