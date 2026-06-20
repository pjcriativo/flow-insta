import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { runClassify } from "./classify";
import { runDecideAndAct, tryKeywordResponse } from "./decide-and-act";
import { runAdvanceFlow } from "./advance-flow";
import type { EventRow } from "./types";

// ============================================================
// Runner do DM Pilot: executa UMA etapa de um interaction_event reivindicado
// (locked_at setado, attempts incrementado pelo claim). Espelha o runner de
// atomização: mapeia status -> etapa, libera o lease em sucesso, agenda retry
// com backoff em falha, e falha o evento ao estourar MAX_ATTEMPTS.
//
// Pipeline:
//   received   --classify-->        classified
//   classified --decide-and-act-->  actioned | held | ignored | failed
//   (DMs de entrada são roteados p/ advance-flow já no 'classified')
// ============================================================

const MAX_ATTEMPTS = 3;

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 10);
}

const TERMINAL = new Set(["actioned", "held", "ignored", "failed"]);

export async function runDmPilotStep(event: EventRow, nowMs: number): Promise<string> {
  const admin = getSupabaseAdminClient();

  if (TERMINAL.has(event.status)) {
    await releaseLock(event.id);
    return event.status;
  }

  try {
    switch (event.status) {
      case "received": {
        // Camada determinística (zip): se uma keyword casa, responde a resposta
        // pronta e marca 'actioned' SEM chamar o LLM. Senão, classifica.
        const handled = await tryKeywordResponse(event);
        if (!handled) await runClassify(event);
        break;
      }
      case "classified":
        // DM de entrada segue o fluxo de conversa; comentário/menção -> regra.
        if (event.type === "message") {
          await runAdvanceFlow(event, nowMs);
        } else {
          await runDecideAndAct(event, nowMs);
        }
        break;
      default:
        await releaseLock(event.id);
        return event.status;
    }

    // Sucesso da etapa: libera o lock e zera o contador p/ a próxima etapa.
    await admin
      .from("interaction_events")
      .update({ locked_at: null, attempts: 0, next_attempt_at: null })
      .eq("id", event.id);

    const { data } = await admin
      .from("interaction_events")
      .select("status")
      .eq("id", event.id)
      .maybeSingle();
    return data?.status ?? event.status;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha na etapa do DM Pilot";
    if (event.attempts >= MAX_ATTEMPTS) {
      await admin
        .from("interaction_events")
        .update({ status: "failed", locked_at: null, processed_at: new Date().toISOString() })
        .eq("id", event.id);
      return "failed";
    }
    const next = new Date(nowMs + backoffMinutes(event.attempts) * 60_000).toISOString();
    await admin
      .from("interaction_events")
      .update({ locked_at: null, next_attempt_at: next })
      .eq("id", event.id);
    console.warn("[dm-pilot] etapa falhou, retry agendado", {
      eventId: event.id,
      status: event.status,
      attempts: event.attempts,
      next,
      message,
    });
    return event.status;
  }
}

async function releaseLock(eventId: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin.from("interaction_events").update({ locked_at: null }).eq("id", eventId);
}
