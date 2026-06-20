import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { generateImage, buildSlidePrompt } from "@/lib/content/image";
import { BrandProfile, ContentType, Slide } from "@/lib/content/types";

// =========================================================
// Runner de geração de imagem (motor pg_cron). Chamado pelo tick para UM
// projeto já reivindicado (status 'generating', lease setado pelo claim).
//
// Fan-out idempotente por slide:
//   - slide já 'completed' -> pula (re-rodar não duplica nem regenera).
//   - slide 1: referência opcional vinda da image_library (project.reference_*).
//   - slides 2+: referência = imagem JÁ gerada do slide 1 (continuidade).
// Falha de 1 slide marca AQUELE slide 'failed' e segue os demais.
// Ao fim: projeto 'completed' (ou 'failed' se algum slide falhou).
//
// Estado vive no banco (image_path/generation_status por slide): reiniciar o
// worker no meio não perde trabalho — o próximo tick reivindica e continua.
// =========================================================

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "flow-insta";

type ProjectRow = {
  id: string;
  organization_id: string;
  brand_id: string | null;
  content_type: ContentType;
};

type SlideRow = {
  id: string;
  slide_number: number;
  role: string | null;
  headline: string | null;
  body: string | null;
  visual_description: string | null;
  image_path: string | null;
  generation_status: string;
};

/**
 * Gera as imagens de um projeto reivindicado. Retorna um resumo. NÃO lança por
 * falha de slide individual (resiliente); só lança em erro irrecuperável de
 * carregamento (o tick trata como falha do step e agenda retry).
 */
export async function runGenerateContentImages(projectId: string): Promise<{
  completed: number;
  failed: number;
  skipped: number;
}> {
  const admin = getSupabaseAdminClient();

  const { data: project, error: projErr } = await admin
    .from("content_projects")
    .select("id, organization_id, brand_id, content_type")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr || !project) throw new Error("project_not_found");
  const proj = project as ProjectRow;

  // Marca (opcional) para o bloco de identidade nos prompts.
  let brand: BrandProfile | null = null;
  if (proj.brand_id) {
    const { data: b } = await admin
      .from("brand_profiles")
      .select("*")
      .eq("id", proj.brand_id)
      .maybeSingle();
    brand = (b as BrandProfile | null) ?? null;
  }

  const { data: slidesData } = await admin
    .from("content_slides")
    .select("id, slide_number, role, headline, body, visual_description, image_path, generation_status")
    .eq("project_id", projectId)
    .order("slide_number", { ascending: true });
  const slides = (slidesData ?? []) as SlideRow[];

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  // Referência de continuidade: a imagem do slide 1 (buffer), carregada/gerada
  // uma vez e reusada pelos slides 2+.
  let firstSlideRef: Buffer | null = null;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const isFirst = i === 0;

    // Idempotência: slide já concluído com imagem -> pula. Se for o slide 1,
    // ainda assim carrega a imagem dele do Storage para servir de referência.
    if (slide.generation_status === "completed" && slide.image_path) {
      skipped++;
      if (isFirst) firstSlideRef = await downloadImage(slide.image_path);
      continue;
    }

    await setSlideStatus(slide.id, "generating", null);

    try {
      const referenceBuffers = !isFirst && firstSlideRef ? [firstSlideRef] : undefined;
      const prompt = buildSlidePrompt({
        brand,
        slide: slideForPrompt(slide),
        contentType: proj.content_type,
        isFirstSlide: isFirst,
        hasReference: Boolean(referenceBuffers?.length),
      });

      const img = await generateImage({
        prompt,
        contentType: proj.content_type,
        referenceBuffers,
      });

      const buffer = Buffer.from(img.b64, "base64");
      const path = `generated/${projectId}/${slide.id}.png`;
      const { error: upErr } = await admin.storage
        .from(STORAGE_BUCKET)
        .upload(path, buffer, { contentType: img.mimeType, upsert: true });
      if (upErr) throw new Error(`storage: ${upErr.message}`);

      await admin
        .from("content_slides")
        .update({ image_path: path, generation_status: "completed", generation_error: null })
        .eq("id", slide.id);
      completed++;

      if (isFirst) firstSlideRef = buffer;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao gerar imagem";
      // Nunca loga o conteúdo do prompt/imagem; só a mensagem de erro.
      console.error("[content/generate-images] slide falhou", { slideId: slide.id, message });
      await setSlideStatus(slide.id, "failed", message.slice(0, 1000));
      failed++;
    }
  }

  // Status final do projeto: failed se algum slide falhou; senão completed.
  const finalStatus = failed > 0 ? "failed" : "completed";
  await admin
    .from("content_projects")
    .update({
      status: finalStatus,
      generation_error: failed > 0 ? `${failed} slide(s) falharam` : null,
    })
    .eq("id", projectId);

  return { completed, failed, skipped };
}

type SlideCopyFields = Pick<SlideRow, "role" | "headline" | "body" | "visual_description">;

function slideForPrompt(s: SlideCopyFields): Pick<Slide, "role" | "headline" | "body" | "visual_description"> {
  return {
    role: (s.role as Slide["role"]) ?? "post",
    headline: s.headline ?? "",
    body: s.body ?? "",
    visual_description: s.visual_description ?? "",
  };
}

async function setSlideStatus(slideId: string, status: string, error: string | null): Promise<void> {
  const admin = getSupabaseAdminClient();
  await admin
    .from("content_slides")
    .update({ generation_status: status, generation_error: error })
    .eq("id", slideId);
}

/** Baixa uma imagem do Storage como Buffer (referência de continuidade). */
async function downloadImage(path: string): Promise<Buffer | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) return null;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Regenera a imagem de UM slide (rota /regenerate-image). Respeita a
 * continuidade: se não for o slide 1, usa a imagem atual do slide 1 como
 * referência. Idempotência NÃO se aplica (regeneração é explícita).
 */
export async function regenerateSlideImage(slideId: string): Promise<void> {
  const admin = getSupabaseAdminClient();

  const { data: slide } = await admin
    .from("content_slides")
    .select("id, project_id, slide_number, role, headline, body, visual_description, organization_id")
    .eq("id", slideId)
    .maybeSingle();
  if (!slide) throw new Error("slide_not_found");

  const { data: project } = await admin
    .from("content_projects")
    .select("id, organization_id, brand_id, content_type")
    .eq("id", slide.project_id)
    .maybeSingle();
  if (!project) throw new Error("project_not_found");
  const proj = project as ProjectRow;

  let brand: BrandProfile | null = null;
  if (proj.brand_id) {
    const { data: b } = await admin.from("brand_profiles").select("*").eq("id", proj.brand_id).maybeSingle();
    brand = (b as BrandProfile | null) ?? null;
  }

  const isFirst = slide.slide_number === 1;
  let referenceBuffers: Buffer[] | undefined;
  if (!isFirst) {
    const { data: firstSlide } = await admin
      .from("content_slides")
      .select("image_path")
      .eq("project_id", slide.project_id)
      .eq("slide_number", 1)
      .maybeSingle();
    if (firstSlide?.image_path) {
      const ref = await downloadImage(firstSlide.image_path);
      if (ref) referenceBuffers = [ref];
    }
  }

  await setSlideStatus(slideId, "generating", null);
  try {
    const prompt = buildSlidePrompt({
      brand,
      slide: slideForPrompt(slide as SlideCopyFields),
      contentType: proj.content_type,
      isFirstSlide: isFirst,
      hasReference: Boolean(referenceBuffers?.length),
    });
    const img = await generateImage({ prompt, contentType: proj.content_type, referenceBuffers });
    const buffer = Buffer.from(img.b64, "base64");
    const path = `generated/${slide.project_id}/${slideId}.png`;
    const { error: upErr } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, buffer, { contentType: img.mimeType, upsert: true });
    if (upErr) throw new Error(`storage: ${upErr.message}`);
    await admin
      .from("content_slides")
      .update({ image_path: path, generation_status: "completed", generation_error: null })
      .eq("id", slideId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha ao regenerar imagem";
    await setSlideStatus(slideId, "failed", message.slice(0, 1000));
    throw new Error(message);
  }
}
