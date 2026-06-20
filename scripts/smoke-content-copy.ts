/**
 * Smoke test da Fase 1: gera copy real (OpenAI) para um carrossel e valida que
 * sai JSON coerente por slide (Zod). Também testa regenerar 1 slide.
 *
 * Roda fora do Next (sem auth/HTTP) — exercita só o núcleo lib/content/copy.ts.
 * Uso: env -u SUPABASE_ACCESS_TOKEN npx tsx scripts/smoke-content-copy.ts
 */
import "dotenv/config";
import { generateCopy, regenerateSlideCopy } from "@/lib/content/copy";
import type { BrandProfile } from "@/lib/content/types";

const brand: BrandProfile = {
  brand_name: "Cafeteria Aurora",
  instagram_handle: "@cafeaurora",
  description: "Cafeteria de especialidade, grãos de origem única.",
  target_audience: "Amantes de café, 25-45, urbanos.",
  tone_of_voice: "Acolhedor, sofisticado sem ser esnobe.",
  color_palette: [
    { name: "Terracota", hex: "#B5651D", role: "primária" },
    { name: "Creme", hex: "#F3E9DC", role: "fundo" },
  ],
  typography: { primary_font: "Playfair Display", style_notes: "Elegante, serifada." },
  visual_style: "Fotografia real, luz quente, aconchego.",
  mood_keywords: ["aconchego", "artesanal", "manhã"],
};

async function main() {
  console.log("== 1. Gerando copy de CARROSSEL (4 slides) ==");
  const res = await generateCopy({
    brand,
    contentType: "carousel",
    idea: "3 sinais de que seu café da manhã merece um café melhor",
    slideCount: 4,
  });

  if (!res.ok) {
    console.error("FALHOU generateCopy:", res.error);
    process.exit(1);
  }

  const slides = res.data.slides;
  console.log(`OK — ${slides.length} slides válidos (Zod):`);
  for (const s of slides) {
    console.log(`  [${s.slide_number}] (${s.role}) ${s.headline}`);
    console.log(`        body: ${(s.body ?? "").slice(0, 60)}`);
    console.log(`        visual: ${s.visual_description.slice(0, 70)}…`);
  }

  // Invariantes esperadas do carrossel.
  const first = slides[0];
  const last = slides[slides.length - 1];
  const checks = [
    [slides.length >= 2, `>=2 slides (got ${slides.length})`],
    [slides.every((s, i) => s.slide_number === i + 1), "slide_number sequencial 1..N"],
    [first.role === "capa", `slide 1 role=capa (got ${first.role})`],
    [last.role === "cta", `último slide role=cta (got ${last.role})`],
  ] as const;

  let allOk = true;
  console.log("\n== Invariantes ==");
  for (const [pass, label] of checks) {
    console.log(`  ${pass ? "✓" : "✗"} ${label}`);
    if (!pass) allOk = false;
  }

  console.log("\n== 2. Regenerando o slide 2 (coerência mantida) ==");
  const reg = await regenerateSlideCopy({
    brand,
    contentType: "carousel",
    idea: "3 sinais de que seu café da manhã merece um café melhor",
    slide: {
      slide_number: slides[1].slide_number,
      role: slides[1].role,
      headline: slides[1].headline,
      body: slides[1].body ?? "",
      visual_description: slides[1].visual_description,
    },
    otherSlides: slides
      .filter((_, i) => i !== 1)
      .map((s) => ({ slide_number: s.slide_number, role: s.role, headline: s.headline })),
  });

  if (!reg.ok) {
    console.error("FALHOU regenerateSlideCopy:", reg.error);
    process.exit(1);
  }
  console.log(`OK — slide ${reg.data.slide_number} (${reg.data.role}) regerado:`);
  console.log(`     ${reg.data.headline}`);
  const regKeepsIdentity = reg.data.slide_number === slides[1].slide_number && reg.data.role === slides[1].role;
  console.log(`  ${regKeepsIdentity ? "✓" : "✗"} mantém slide_number e role originais`);
  if (!regKeepsIdentity) allOk = false;

  console.log(allOk ? "\nSMOKE TEST PASSOU ✓" : "\nSMOKE TEST FALHOU ✗");
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("ERRO inesperado:", e);
  process.exit(1);
});
