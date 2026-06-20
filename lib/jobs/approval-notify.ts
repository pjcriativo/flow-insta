import { getSupabaseAdminClient } from "@/lib/supabase-server";

const DECISION_LABEL: Record<string, string> = {
  approved: "aprovou",
  changes_requested: "pediu ajustes em",
  rejected: "reprovou",
};

export type ApprovalNotifyPayload = {
  collection_id: string;
  organization_id: string;
  collection_item_id: string | null;
  decision: string;
  decision_id?: string | null;
};

/**
 * ENFILEIRA a notificação (durável). Chamada pela rota /decide: insere uma
 * linha 'pending' em approval_notifications e retorna rápido — NÃO envia nem
 * bloqueia a request (invariante #8). O tick reivindica e envia depois.
 * Best-effort: falha de insert não quebra a decisão (loga e segue).
 */
export async function enqueueApprovalNotification(payload: ApprovalNotifyPayload) {
  const admin = getSupabaseAdminClient();
  try {
    const { error } = await admin.from("approval_notifications").insert({
      organization_id: payload.organization_id,
      collection_id: payload.collection_id,
      collection_item_id: payload.collection_item_id,
      decision_id: payload.decision_id ?? null,
      decision: payload.decision,
      channel: "email",
      status: "pending",
      payload: {},
    });
    if (error) {
      console.error("[approval-notify] enqueue falhou", error.message);
      return { enqueued: false };
    }
    return { enqueued: true };
  } catch (e) {
    console.error("[approval-notify] enqueue erro", String(e));
    return { enqueued: false };
  }
}

/**
 * ENVIA a notificação à agência (e-mail + WhatsApp). Chamada pelo tick a partir
 * de uma linha reivindicada da fila. Best-effort no canal, mas o resultado
 * informa o tick se deve marcar 'sent' ou reagendar.
 *
 * E-mail via Resend; se RESEND_API_KEY não estiver setado, vira no-op (log).
 * WhatsApp via Cloud API só se WHATSAPP_CLOUD_TOKEN + WHATSAPP_PHONE_NUMBER_ID
 * + WHATSAPP_NOTIFY_TO estiverem setados.
 */
export async function sendApprovalNotification(payload: ApprovalNotifyPayload) {
  const { collection_id, organization_id, collection_item_id, decision } = payload;
  const admin = getSupabaseAdminClient();

  // Carrega contexto (coleção + branding + e-mail do criador).
  const { data: collection } = await admin
    .from("approval_collections")
    .select("id, title, client_name, status, created_by")
    .eq("id", collection_id)
    .maybeSingle();

  if (!collection) {
    return { skipped: true, reason: "collection_not_found" };
  }

  const { data: branding } = await admin
    .from("workspace_branding")
    .select("email_from_name")
    .eq("organization_id", organization_id)
    .maybeSingle();

  let agencyEmail: string | null = null;
  if (collection.created_by) {
    const { data: u } = await admin.auth.admin.getUserById(collection.created_by);
    agencyEmail = u?.user?.email ?? null;
  }

  const verb = DECISION_LABEL[decision] ?? "atualizou";
  const subject = `${collection.client_name} ${verb} um post — ${collection.title}`;
  const fromName = branding?.email_from_name || "Flow Insta";

  // --- E-mail (Resend) ---
  const emailResult = await sendEmail({ subject, agencyEmail, fromName, collection, verb, collection_item_id });

  // --- WhatsApp (opcional) ---
  const whatsappResult = await sendWhatsapp(subject);

  return { email: emailResult, whatsapp: whatsappResult };
}

async function sendEmail(args: {
  subject: string;
  agencyEmail: string | null;
  fromName: string;
  collection: { client_name: string; title: string; status: string };
  verb: string;
  collection_item_id: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info("[approval-notify] RESEND_API_KEY ausente — e-mail não enviado (no-op)", args.subject);
    return { sent: false, reason: "no_api_key" };
  }
  if (!args.agencyEmail) {
    console.info("[approval-notify] Sem e-mail da agência — e-mail não enviado");
    return { sent: false, reason: "no_recipient" };
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `${args.fromName} <onboarding@resend.dev>`,
      to: args.agencyEmail,
      subject: args.subject,
      html: `
        <div style="font-family:system-ui,sans-serif">
          <p>O cliente <strong>${escapeHtml(args.collection.client_name)}</strong> ${args.verb} um post da coleção <strong>${escapeHtml(args.collection.title)}</strong>.</p>
          <p>Status atual da coleção: <strong>${args.collection.status}</strong>.</p>
          <p style="color:#666;font-size:13px">Item: ${args.collection_item_id}</p>
        </div>`,
    });
    return { sent: true };
  } catch (e) {
    console.error("[approval-notify] Falha ao enviar e-mail", String(e));
    return { sent: false, reason: "send_error" };
  }
}

async function sendWhatsapp(subject: string) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_NOTIFY_TO;
  if (!token || !phoneId || !to) {
    return { sent: false, reason: "not_configured" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: subject },
      }),
    });
    return { sent: res.ok };
  } catch (e) {
    console.error("[approval-notify] Falha ao enviar WhatsApp", String(e));
    return { sent: false, reason: "send_error" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
