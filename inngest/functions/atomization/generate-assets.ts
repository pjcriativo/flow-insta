import { inngest } from "../../client";
import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { getOpenAI, AI_MODEL } from "@/lib/ai";
import { loadJob, setJobStatus, failJob, isTerminal } from "@/lib/atomization/pipeline";
import { AssetCopySchema, parseAiJson } from "@/lib/atomization/schemas";
import { assetCopyPrompt } from "@/lib/atomization/prompts";
import { getVoiceInstruction } from "@/lib/atomization/voice";

// 4ª etapa: gera copy na voz da marca por clip e cria posts draft.
// Idempotente: asset por (clip_id, asset_type); post draft por clip.
export const atomizationGenerateAssets = inngest.createFunction(
  { id: "atomization-generate-assets", name: "Atomization: Generate Assets", retries: 2, triggers: [{ event: "atomization/clips.rendered" }] },
  async ({ event, step, logger }) => {
    const { jobId } = event.data as { jobId: string };

    try {
      const job = await step.run("load-job", () => loadJob(jobId));
      if (!job) return { skipped: true, reason: "job_not_found" };
      if (isTerminal(job.status)) return { skipped: true, reason: job.status };

      await step.run("status-generating", () => setJobStatus(jobId, "generating"));

      await step.run("generate", async () => {
        const admin = getSupabaseAdminClient();
        const orgId = job.organization_id;

        const { data: clips } = await admin
          .from("atomization_clips")
          .select("id, hook_text, rationale, status")
          .eq("job_id", jobId)
          .eq("status", "rendered")
          .order("clip_index", { ascending: true });

        const voice = await getVoiceInstruction(admin, orgId);

        for (const clip of clips ?? []) {
          // Idempotência: se já existe asset reel_caption para o clip, pula.
          const { data: existingAsset } = await admin
            .from("atomization_assets")
            .select("id, post_id")
            .eq("clip_id", clip.id)
            .eq("asset_type", "reel_caption")
            .maybeSingle();
          if (existingAsset) continue;

          // Gera copy.
          const completion = await getOpenAI().chat.completions.create({
            model: AI_MODEL,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: assetCopyPrompt(voice) },
              { role: "user", content: `Gancho: ${clip.hook_text ?? ""}\nContexto: ${clip.rationale ?? ""}` },
            ],
          });
          const parsed = parseAiJson(AssetCopySchema, completion.choices[0]?.message?.content);
          if (!parsed.ok) {
            throw new Error(`Copy inválida: ${parsed.error}`);
          }
          const copy = parsed.data;

          // Cria UM post draft por clip (idempotente: já checamos asset acima).
          // organization_id SEMPRE do job; sem canal definido ainda.
          const { data: post } = await admin
            .from("scheduled_posts")
            .insert({
              org_id: orgId,
              user_id: job.created_by,
              user_channel_id: null,
              content: copy.reel_caption,
              images: [],
              scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString(), // placeholder; draft
              status: "draft",
            })
            .select("id")
            .single();

          // Grava os 4 assets ligados ao clip (upsert idempotente por clip+type).
          const assets = [
            { asset_type: "reel_caption" as const, payload: { caption: copy.reel_caption } },
            { asset_type: "carousel" as const, payload: { slides: copy.carousel } },
            { asset_type: "story" as const, payload: { text: copy.story } },
            { asset_type: "hashtags" as const, payload: { hashtags: copy.hashtags } },
          ];
          await admin.from("atomization_assets").upsert(
            assets.map((a) => ({
              clip_id: clip.id,
              organization_id: orgId,
              asset_type: a.asset_type,
              payload: a.payload,
              post_id: a.asset_type === "reel_caption" ? post?.id ?? null : null,
            })),
            { onConflict: "clip_id,asset_type", ignoreDuplicates: true }
          );
        }
      });

      await step.sendEvent("to-schedule", {
        name: "atomization/assets.generated",
        data: { jobId, organizationId: job.organization_id },
      });

      logger.info("Assets generated", { jobId });
      return { ok: true };
    } catch (e) {
      await failJob(jobId, e instanceof Error ? e.message : "Falha ao gerar ativos");
      return { ok: false };
    }
  }
);
