import { NextRequest, NextResponse } from "next/server";
import { verifySignature } from "@/lib/meta/verify";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { igWebhookSchema, type NormalizedEvent, type InteractionType } from "@/types/dm-pilot";

// Webhook do Instagram (Graph API).
// - GET: verificação do endpoint (handshake hub.challenge).
// - POST: eventos. Valida assinatura, resolve org pelo canal, grava
//   interaction_events com status='received' e responde 200 em <2s.
//   O processamento é ASSÍNCRONO via /api/cron/tick (status = fila).
export const dynamic = "force-dynamic";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

// ---------------------------------------------------------
// GET — verificação do endpoint (Meta envia hub.* na configuração)
// ---------------------------------------------------------
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
    // A Meta espera o challenge ecoado como texto puro.
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// ---------------------------------------------------------
// POST — recebimento de eventos
// ---------------------------------------------------------
export async function POST(req: NextRequest) {
  // 1) Corpo CRU — necessário para validar a assinatura byte-a-byte.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  // INVARIANTE #1: assinatura inválida -> 401 e NADA gravado.
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 2) Parse + validação do payload (Zod). Payload malformado: 200 para a Meta
  //    não reentregar em loop, mas sem gravar nada.
  let payload: ReturnType<typeof igWebhookSchema.parse>;
  try {
    payload = igWebhookSchema.parse(JSON.parse(rawBody));
  } catch {
    console.warn("[webhook/instagram] payload inválido");
    return NextResponse.json({ ok: true, ignored: "malformed" }, { status: 200 });
  }

  // 3) Processa de forma rápida e responde 200. Erros internos são engolidos
  //    (logados) para não fazer a Meta reentregar indefinidamente — eventos
  //    não gravados por falha transitória são raros e a Meta reenvia mesmo.
  try {
    await ingest(payload);
  } catch (e) {
    console.error("[webhook/instagram] erro ao ingerir", String(e));
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ---------------------------------------------------------
// Ingestão: resolve org pelo canal e grava cada evento (dedupe).
// ---------------------------------------------------------
async function ingest(payload: ReturnType<typeof igWebhookSchema.parse>): Promise<void> {
  const admin = getSupabaseAdminClient();

  for (const entry of payload.entry) {
    // entry.id é o IG account id que recebeu o evento. INVARIANTE #4:
    // resolvemos channel + org a partir DELE, nunca confiando em org no payload.
    const igAccountId = entry.id;

    const { data: channel, error: chErr } = await admin
      .from("user_channels")
      .select("id, org_id")
      .eq("provider_account_id", igAccountId)
      .maybeSingle();

    if (chErr) {
      console.error("[webhook/instagram] erro ao resolver canal", chErr.message);
      continue;
    }
    if (!channel || !channel.org_id) {
      // Canal desconhecido ou sem org -> ignora (não temos como atribuir).
      console.warn("[webhook/instagram] canal não encontrado p/ IG account", igAccountId);
      continue;
    }

    const events = normalizeEntry(entry);
    for (const ev of events) {
      // INVARIANTE #2: idempotência por (provider, provider_event_id).
      // upsert com ignoreDuplicates -> conflito = no-op (a Meta reentrega).
      const { error: insErr } = await admin
        .from("interaction_events")
        .upsert(
          {
            organization_id: channel.org_id,
            channel_id: channel.id,
            provider: "instagram",
            provider_event_id: ev.providerEventId,
            type: ev.type,
            external_user_id: ev.externalUserId,
            external_username: ev.externalUsername,
            post_external_id: ev.postExternalId,
            text: ev.text,
            raw: ev.raw,
            status: "received",
          },
          { onConflict: "provider,provider_event_id", ignoreDuplicates: true }
        );

      if (insErr) {
        console.error("[webhook/instagram] erro ao gravar evento", insErr.message);
      }
    }
  }
}

// ---------------------------------------------------------
// Normaliza um entry do payload em 0..N eventos.
//   changes[]   -> comentários / menções
//   messaging[] -> DMs
// Cada evento precisa de um provider_event_id estável p/ dedupe.
// ---------------------------------------------------------
function normalizeEntry(entry: ReturnType<typeof igWebhookSchema.parse>["entry"][number]): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];

  for (const change of entry.changes ?? []) {
    const v = change.value;
    const type: InteractionType = change.field === "mentions" ? "mention" : "comment";
    // id do comentário (ou comment_id em menções) é o identificador estável.
    const providerEventId = v.id ?? v.comment_id ?? null;
    if (!providerEventId) continue;

    out.push({
      providerEventId,
      type,
      externalUserId: v.from?.id ?? null,
      externalUsername: v.from?.username ?? null,
      postExternalId: v.media?.id ?? v.media_id ?? null,
      text: v.text ?? null,
      raw: change,
    });
  }

  for (const m of entry.messaging ?? []) {
    const mid = m.message?.mid;
    if (!mid) continue; // só mensagens com id estável (ignora read/delivery)

    out.push({
      providerEventId: mid,
      type: "message",
      externalUserId: m.sender.id,
      externalUsername: null,
      postExternalId: null,
      text: m.message?.text ?? null,
      raw: m,
    });
  }

  return out;
}
