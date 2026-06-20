import { claimAtomizationJobs, claimDuePosts } from "./claim";
import { runAtomizationStep } from "./atomization/runner";
import { runPublishPost } from "./publish";

// Tetos por chamada do tick (protegem contra estouro de tempo serverless).
const PUBLISH_LIMIT = 10;
const ATOM_JOBS_PER_TICK = 5;

/**
 * Processa os posts agendados vencidos: reivindica (queue -> publishing) e
 * publica cada um. Concorrência segura: o claim usa SKIP LOCKED, então dois
 * ticks simultâneos nunca pegam o mesmo post.
 */
export async function runPublishTick({ limit = PUBLISH_LIMIT } = {}) {
  const postIds = await claimDuePosts(limit);
  let published = 0;
  let skipped = 0;
  let failed = 0;

  for (const postId of postIds) {
    try {
      const r = await runPublishPost(postId);
      if (r.published) published++;
      else if (r.skipped) skipped++;
      else failed++;
    } catch (e) {
      failed++;
      console.error("[tick] runPublishPost erro", postId, String(e));
    }
  }

  return { claimed: postIds.length, published, skipped, failed };
}

/**
 * Avança a atomização: reivindica jobs e executa UMA etapa de cada, repetindo
 * enquanto houver orçamento de tempo. Como cada etapa avança o status, um job
 * pode percorrer várias etapas dentro do mesmo tick (sem nunca segurar lock
 * de linha durante o I/O — o runner libera o lock ao fim de cada etapa).
 */
// Quantas vezes um mesmo job pode ser processado dentro de UM tick. Permite o
// render avançar vários lotes (cada passada renderiza +3 clips), mas impede um
// job preso (sucesso da etapa sem avançar status — ex.: clip órfão) de girar em
// falso consumindo todo o budget e causando starvation dos demais.
const MAX_STEPS_PER_JOB_PER_TICK = 8;

export async function runAtomizationTick({
  limit = ATOM_JOBS_PER_TICK,
  budgetMs = 50_000,
  startedAt = Date.now(),
} = {}) {
  let stepsRun = 0;
  let advanced = 0;
  const processedCount = new Map<string, number>();

  while (Date.now() - startedAt < budgetMs) {
    const jobs = await claimAtomizationJobs(limit);
    // Ignora jobs que já atingiram o teto de passadas neste tick (resumem no
    // próximo tick). Se sobrou nada processável, encerra.
    const workable = jobs.filter(
      (j) => (processedCount.get(j.id) ?? 0) < MAX_STEPS_PER_JOB_PER_TICK
    );
    if (workable.length === 0) break;

    for (const job of workable) {
      if (Date.now() - startedAt >= budgetMs) break;
      const before = job.status;
      const after = await runAtomizationStep(job);
      stepsRun++;
      processedCount.set(job.id, (processedCount.get(job.id) ?? 0) + 1);
      if (after !== before) advanced++;
    }
  }

  return { stepsRun, advanced };
}

/** Executa o tick completo (publicação + atomização). */
export async function runTick({ startedAt = Date.now(), budgetMs = 50_000 } = {}) {
  const publish = await runPublishTick();
  const atomization = await runAtomizationTick({ startedAt, budgetMs });
  return { publish, atomization, ms: Date.now() - startedAt };
}
