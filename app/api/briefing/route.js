import { streamText } from "ai";

import { aiErrorStatus, publicAiErrorMessage } from "@/lib/ai-errors.mjs";
import {
  ArticleBatchError,
  extractArticleBatch,
} from "@/lib/article-extractor.mjs";
import {
  BRIEFING_SYSTEM_PROMPT,
  buildBriefingPrompt,
} from "@/lib/briefing-prompt.mjs";
import {
  BriefingTokenError,
  verifyBriefingToken,
} from "@/lib/briefing-token.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_MODEL = "openai/gpt-5-mini";
const FREE_ONLY_MODELS = new Set([DEFAULT_MODEL]);
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function jsonError(status, code, message, extra = {}) {
  return Response.json(
    { code, message, ...extra },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function POST(request) {
  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
  }

  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  if (!FREE_ONLY_MODELS.has(model)) {
    return jsonError(
      500,
      "PAID_MODEL_BLOCKED",
      "무료 운영을 위해 AI_MODEL은 openai/gpt-5-mini만 사용할 수 있습니다."
    );
  }

  try {
    const payload = verifyBriefingToken(requestBody?.briefingToken);
    const extractedArticles = await extractArticleBatch(payload.articles);
    const prompt = buildBriefingPrompt({
      query: payload.query,
      articles: extractedArticles,
    });

    const result = streamText({
      model,
      system: BRIEFING_SYSTEM_PROMPT,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 1_800,
      abortSignal: request.signal,
      providerOptions: {
        gateway: {
          tags: ["feature:news-briefing", "tier:free-only"],
        },
      },
    });

    return result.toUIMessageStreamResponse({
      headers: NO_STORE_HEADERS,
      onError(error) {
        console.error("[briefing] AI stream failed", {
          name: error?.name || "UnknownError",
          status: aiErrorStatus(error),
        });
        return publicAiErrorMessage(error);
      },
    });
  } catch (error) {
    if (error instanceof BriefingTokenError) {
      return jsonError(error.status, error.code, error.message);
    }

    if (error instanceof ArticleBatchError) {
      return jsonError(422, error.code, error.message, {
        articles: error.articles,
      });
    }

    const status = aiErrorStatus(error);
    if (status === 402 || status === 429) {
      return jsonError(429, "AI_FREE_LIMIT_REACHED", publicAiErrorMessage(error));
    }

    if (status === 408 || status === 504) {
      return jsonError(504, "AI_TIMEOUT", publicAiErrorMessage(error));
    }

    if (status) {
      return jsonError(502, "AI_PROVIDER_ERROR", publicAiErrorMessage(error));
    }

    return jsonError(
      500,
      "BRIEFING_SERVER_ERROR",
      "브리핑 준비 중 서버 오류가 발생했습니다."
    );
  }
}
