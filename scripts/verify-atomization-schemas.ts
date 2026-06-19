/**
 * Verifica que os schemas Zod rejeitam saída malformada da IA.
 * Roda com: npx tsx scripts/verify-atomization-schemas.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  ClipSelectionSchema,
  AssetCopySchema,
  CreateJobInputSchema,
  parseAiJson,
} = require("../lib/atomization/schemas");

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

// --- Seleção de clips ---
const validClips = JSON.stringify({
  clips: [{ start_seconds: 10, end_seconds: 45, hook_text: "Olha isso", rationale: "alto engajamento", virality_score: 0.82 }],
});
check("clips válidos => ok", parseAiJson(ClipSelectionSchema, validClips).ok === true);

check("JSON quebrado => rejeitado", parseAiJson(ClipSelectionSchema, "{clips: [").ok === false);
check("clips vazio => rejeitado", parseAiJson(ClipSelectionSchema, JSON.stringify({ clips: [] })).ok === false);
check(
  "end <= start => rejeitado",
  parseAiJson(ClipSelectionSchema, JSON.stringify({ clips: [{ start_seconds: 50, end_seconds: 20, hook_text: "x", rationale: "y", virality_score: 0.5 }] })).ok === false
);
check(
  "score fora de [0,1] => rejeitado",
  parseAiJson(ClipSelectionSchema, JSON.stringify({ clips: [{ start_seconds: 1, end_seconds: 2, hook_text: "x", rationale: "y", virality_score: 5 }] })).ok === false
);
check(
  "campo faltando => rejeitado",
  parseAiJson(ClipSelectionSchema, JSON.stringify({ clips: [{ start_seconds: 1, end_seconds: 2, hook_text: "x" }] })).ok === false
);

// --- Copy dos assets ---
const validCopy = JSON.stringify({
  reel_caption: "Legenda do reel",
  carousel: [{ title: "Slide 1", body: "..." }, { title: "Slide 2", body: "..." }],
  story: "Texto do story",
  hashtags: ["#growth", "#marketing"],
});
check("copy válida => ok", parseAiJson(AssetCopySchema, validCopy).ok === true);
check(
  "carousel com 1 slide => rejeitado",
  parseAiJson(AssetCopySchema, JSON.stringify({ reel_caption: "x", carousel: [{ title: "a", body: "b" }], story: "s", hashtags: ["#x"] })).ok === false
);
check("hashtags vazio => rejeitado",
  parseAiJson(AssetCopySchema, JSON.stringify({ reel_caption: "x", carousel: [{ title: "a", body: "b" }, { title: "c", body: "d" }], story: "s", hashtags: [] })).ok === false
);

// --- Input do wizard ---
check("input sem atestado => rejeitado",
  CreateJobInputSchema.safeParse({ source_url: "https://youtu.be/abc", rights_attested: false }).success === false
);
check("input URL inválida => rejeitado",
  CreateJobInputSchema.safeParse({ source_url: "não é url", rights_attested: true }).success === false
);
check("input válido => ok",
  CreateJobInputSchema.safeParse({ source_url: "https://youtu.be/abc", rights_attested: true }).success === true
);

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
