import { inngest } from "../../client";
import { getSupabaseAdminClient } from "@/lib/supabase-server";

const DECISION_LABEL: Record<string, string> = {
  approved: "aprovou",
  changes_requested: "pediu ajustes em",
  rejected: "reprovou",
};

/**
 * Notifica a agência quando o cliente toma uma decisão.
 * Disparado por `approval/decision.made` (emitido por /api/approvals/public/decide).
 *
 * E-mail via Resend; se RESEND_API_KEY não estiver setado, vira no-op (log).
 * WhatsApp via Cloud API só se WHATSAPP_CLOUD_TOKEN + WHATSAPP_PHONE_NUMBER_ID
 * estiverem setados.
 */
export const notifyApprovalDecision = inngest.createFunction(
  {
    id: "approval-notify-decision",
    name: "Notify Approval Decision",
    triggers: [{ event: "approval/decision.made" }],
  },
  async ({ event, step, logger }) => {
    const { collection_id, organization_id, collection_item_id, decision } =
      event.data as {
        collection_id: string;
        organization_id: string;
        collection_item_id: string;
        decision: string;
      };

    // Carrega contexto (coleção + branding + e-mail do criador).
    const ctx = await step.run("load-context", async () => {
      const admin = getSupabaseAdminClient();

      const { data: collection } = await admin
        .from("approval_collections")
        .select("id, title, client_name, status, created_by")
        .eq("id", collection_id)
        .maybeSingle();

      const { data: branding } = await admin
        .from("workspace_branding")
        .select("email_from_name")
        .eq("organization_id", organization_id)
        .maybeSingle();

      let agencyEmail: string | null = null;
      if (collection?.created_by) {
        const { data: u } = await admin.auth.admin.getUserById(collection.created_by);
        agencyEmail = u?.user?.email ?? null;
      }

      return { collection, branding, agencyEmail };
    });

    if (!ctx.collection) {
      return { skipped: true, reason: "collection_not_found" };
    }

    const verb = DECISION_LABEL[decision] ?? "atualizou";
    const subject = `${ctx.collection.client_name} ${verb} um post — ${ctx.collection.title}`;
    const fromName = ctx.branding?.email_from_name || "Flow Insta";

    // --- E-mail (Resend) ---
    const emailResult = await step.run("send-email", async () => {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        logger.info("RESEND_API_KEY ausente — e-mail não enviado (no-op)", { subject });
        return { sent: false, reason: "no_api_key" };
      }
      if (!ctx.agencyEmail) {
        logger.info("Sem e-mail da agência — e-mail não enviado");
        return { sent: false, reason: "no_recipient" };
      }
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: `${fromName} <onboarding@resend.dev>`,
          to: ctx.agencyEmail,
          subject,
          html: `
            <div style="font-family:system-ui,sans-serif">
              <p>O cliente <strong>${escapeHtml(ctx.collection!.client_name)}</strong> ${verb} um post da coleção <strong>${escapeHtml(ctx.collection!.title)}</strong>.</p>
              <p>Status atual da coleção: <strong>${ctx.collection!.status}</strong>.</p>
              <p style="color:#666;font-size:13px">Item: ${collection_item_id}</p>
            </div>`,
        });
        return { sent: true };
      } catch (e) {
        logger.error("Falha ao enviar e-mail", { error: String(e) });
        return { sent: false, reason: "send_error" };
      }
    });

    // --- WhatsApp (opcional) ---
    const whatsappResult = await step.run("send-whatsapp", async () => {
      const token = process.env.WHATSAPP_CLOUD_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const to = process.env.WHATSAPP_NOTIFY_TO; // destino opcional
      if (!token || !phoneId || !to) {
        return { sent: false, reason: "not_configured" };
      }
      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${phoneId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to,
              type: "text",
              text: { body: subject },
            }),
          }
        );
        return { sent: res.ok };
      } catch (e) {
        logger.error("Falha ao enviar WhatsApp", { error: String(e) });
        return { sent: false, reason: "send_error" };
      }
    });

    return { email: emailResult, whatsapp: whatsappResult };
  }
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
