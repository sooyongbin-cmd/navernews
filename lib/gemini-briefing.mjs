import {
  extractArticleBatch,
} from "./article-extractor.mjs";
import {
  BRIEFING_SYSTEM_PROMPT,
  buildBriefingPrompt,
} from "./briefing-prompt.mjs";
import { verifyBriefingToken } from "./briefing-token.mjs";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const GEMINI_MODEL_TIMEOUT_MS = 45_000;

export function buildGeminiInteractionRequest({
  model = DEFAULT_GEMINI_MODEL,
  prompt,
  systemPrompt = BRIEFING_SYSTEM_PROMPT,
}) {
  return {
    model,
    input: prompt,
    system_instruction: systemPrompt,
    stream: true,
    store: false,
    generation_config: {
      temperature: 0.2,
      thinking_level: "low",
      max_output_tokens: 1_800,
    },
  };
}

export async function startGeminiBriefing({
  briefingToken,
  createInteraction,
  verifyToken = verifyBriefingToken,
  extractArticles = extractArticleBatch,
  makePrompt = buildBriefingPrompt,
}) {
  const payload = verifyToken(briefingToken);
  const extractedArticles = await extractArticles(payload.articles);
  const prompt = makePrompt({
    query: payload.query,
    articles: extractedArticles,
  });

  const stream = await createInteraction({ prompt });
  return { stream };
}

export function geminiTextDelta(event) {
  if (event?.event_type !== "step.delta") return "";
  if (event?.delta?.type !== "text") return "";
  return typeof event.delta.text === "string" ? event.delta.text : "";
}

export function geminiStreamError(event) {
  if (event?.event_type !== "error") return null;

  const error = new Error(
    event?.error?.message || "Gemini interaction stream failed."
  );
  error.code = event?.error?.code || "GEMINI_STREAM_ERROR";
  return error;
}

export function hasRequiredSourceCitations(text) {
  return ["[1]", "[2]", "[3]"].every((citation) => text.includes(citation));
}
