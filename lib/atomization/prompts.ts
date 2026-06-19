// Prompts da IA para o pipeline de atomização.

/** Prompt de seleção de clips a partir do transcript. */
export function clipSelectionPrompt(targetCount: number): string {
  return `Você é um editor especialista em conteúdo viral para Reels/Shorts/TikTok.
A partir do transcript (com timestamps), selecione os ${targetCount} melhores trechos
para virar clips curtos (15-60s cada).

Critérios: gancho forte nos primeiros segundos, ideia completa, alto potencial de
compartilhamento, sem cortar no meio de uma frase.

Retorne APENAS JSON válido no formato:
{"clips":[{"start_seconds":number,"end_seconds":number,"hook_text":"string","rationale":"string","virality_score":number}]}
- start_seconds < end_seconds, ambos dentro da duração do vídeo.
- virality_score entre 0 e 1.
- hook_text: a primeira frase de impacto do clip.
- rationale: por que esse trecho funciona (1 frase).
Não use markdown. Apenas o objeto JSON.`;
}

/** Prompt de copy dos assets (na voz da marca). */
export function assetCopyPrompt(voiceInstruction: string): string {
  return `Você é um redator de social media. ${voiceInstruction}

A partir do trecho de vídeo (hook + contexto), gere os textos para publicação.
Retorne APENAS JSON válido no formato:
{
  "reel_caption": "string (legenda do reel, com 1-2 emojis)",
  "carousel": [{"title":"string","body":"string"}, ...] (3 a 6 slides),
  "story": "string (texto curto para story)",
  "hashtags": ["#tag", ...] (5 a 15 hashtags relevantes)
}
Escreva em português. Não use markdown. Apenas o objeto JSON.`;
}
