import OpenAI from "openai";

// Default model used across AI features. Override per call if needed.
export const AI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

let client: OpenAI | null = null;

/**
 * Returns a lazily-initialized OpenAI client.
 *
 * The key is validated on first use (not at module load) so that builds and
 * routes that don't use AI don't fail when OPENAI_API_KEY is absent.
 */
export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not defined");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}
