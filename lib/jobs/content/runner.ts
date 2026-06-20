import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { runGenerateContentImages } from "./generate-images";

// =========================================================
// Runner do step de geração de imagem para UM projeto reivindicado
// (status 'generating', lease setado pelo claim). Espelha a disciplina de
// lock/retry/backoff do runner de atomização.
//
// - Sucesso (runGenerateContentImages sempre define o status final do projeto:
//   completed ou failed): libera o lock e zera attempts.
// - Erro irrecuperável de carregamento (projeto sumiu etc.): se estourou o teto
//   de tentativas, falha o projeto; senão agenda retry com backoff.
// =========================================================

const MAX_ATTEMPTS = 3;

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 10);
}

export async function runContentImagesStep(job: { id: string; attempts: number }): Promise<void> {
  const admin = getSupabaseAdminClient();
  try {
    await runGenerateContentImages(job.id);
    // O status final (completed/failed) já foi gravado pelo gerador. Só libera
    // o lease e zera o contador.
    await admin
      .from("content_projects")
      .update({ locked_at: null, attempts: 0, next_attempt_at: null })
      .eq("id", job.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha na geração de imagem";
    if (job.attempts >= MAX_ATTEMPTS) {
      await admin
        .from("content_projects")
        .update({ status: "failed", locked_at: null, generation_error: message.slice(0, 1000) })
        .eq("id", job.id);
      return;
    }
    const next = new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString();
    await admin
      .from("content_projects")
      .update({ locked_at: null, next_attempt_at: next, generation_error: message.slice(0, 1000) })
      .eq("id", job.id);
    console.warn("[content/images] step falhou, retry agendado", {
      projectId: job.id,
      attempts: job.attempts,
      next,
      message,
    });
  }
}
