import { randomUUID } from "node:crypto";

import { GoogleGenAI } from "@google/genai";

import {
  ArticleBatchError,
} from "@/lib/article-extractor.mjs";
import {
  buildGeminiInteractionRequest,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_TIMEOUT_MS,
  geminiStreamError,
  geminiTextDelta,
  hasRequiredSourceCitations,
  startGeminiBriefing,
} from "@/lib/gemini-briefing.mjs";
import {
  geminiErrorCode,
  geminiErrorStatus,
  publicGeminiErrorMessage,
} from "@/lib/gemini-errors.mjs";
import { BriefingTokenError } from "@/lib/briefing-token.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

let geminiClient = null;

class GeminiConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GeminiConfigurationError";
    this.code = code;
  }
}

function responseHeaders(requestId, extra = {}) {
  return {
    ...NO_STORE_HEADERS,
    "X-Briefing-Request-Id": requestId,
    ...extra,
  };
}

function jsonError(status, code, message, requestId, extra = {}) {
  return Response.json(
    { code, message, requestId, ...extra },
    { status, headers: responseHeaders(requestId) }
  );
}

function configuredModel() {
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  if (model !== DEFAULT_GEMINI_MODEL) {
    throw new GeminiConfigurationError(
      "GEMINI_PAID_MODEL_BLOCKED",
      `무료 운영을 위해 GEMINI_MODEL은 ${DEFAULT_GEMINI_MODEL}만 사용할 수 있습니다.`
    );
  }
  return model;
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigurationError(
      "GEMINI_CONFIGURATION_ERROR",
      "Gemini API 키가 설정되지 않았습니다. Vercel 환경 변수 GEMINI_API_KEY를 확인해 주세요."
    );
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      apiVersion: "v1",
    });
  }

  return geminiClient;
}

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamGeminiResponse(stream, requestId) {
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let generatedText = "";

      try {
        for await (const event of stream) {
          const providerError = geminiStreamError(event);
          if (providerError) throw providerError;

          const text = geminiTextDelta(event);
          if (!text) continue;

          generatedText += text;
          controller.enqueue(encoder.encode(sseEvent("delta", { text })));
        }

        if (!generatedText.trim()) {
          const error = new Error("Gemini returned an empty response.");
          error.code = "GEMINI_EMPTY_RESPONSE";
          throw error;
        }

        if (!hasRequiredSourceCitations(generatedText)) {
          controller.enqueue(
            encoder.encode(
              sseEvent("error", {
                code: "GEMINI_CITATION_VALIDATION_FAILED",
                message:
                  "Gemini 브리핑에 [1], [2], [3] 출처가 모두 포함되지 않아 결과를 표시하지 않았습니다. 다시 시도해 주세요.",
                status: 502,
                requestId,
              })
            )
          );
          return;
        }

        controller.enqueue(
          encoder.encode(sseEvent("complete", { requestId }))
        );
      } catch (error) {
        const status = geminiErrorStatus(error) || 502;
        const code =
          error?.code === "GEMINI_EMPTY_RESPONSE"
            ? "GEMINI_EMPTY_RESPONSE"
            : geminiErrorCode(error);
        const message =
          code === "GEMINI_EMPTY_RESPONSE"
            ? "Gemini가 비어 있는 브리핑을 반환했습니다. 다시 시도해 주세요."
            : publicGeminiErrorMessage(error);

        console.error("[gemini-briefing] AI stream failed", {
          requestId,
          code,
          name: error?.name || "UnknownError",
          status,
        });

        controller.enqueue(
          encoder.encode(
            sseEvent("error", { code, message, status, requestId })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: responseHeaders(requestId, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    }),
  });
}

export async function POST(request) {
  const requestId = randomUUID();
  let requestBody;

  try {
    requestBody = await request.json();
  } catch {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "요청 형식이 올바르지 않습니다.",
      requestId
    );
  }

  try {
    const model = configuredModel();
    const client = getGeminiClient();
    const { stream } = await startGeminiBriefing({
      briefingToken: requestBody?.briefingToken,
      createInteraction({ prompt }) {
        return client.interactions.create(
          buildGeminiInteractionRequest({ model, prompt }),
          {
            timeout: GEMINI_MODEL_TIMEOUT_MS,
            fetchOptions: { signal: request.signal },
            maxRetries: 0,
          }
        );
      },
    });

    return streamGeminiResponse(stream, requestId);
  } catch (error) {
    if (error instanceof GeminiConfigurationError) {
      return jsonError(500, error.code, error.message, requestId);
    }

    if (error instanceof BriefingTokenError) {
      return jsonError(error.status, error.code, error.message, requestId);
    }

    if (error instanceof ArticleBatchError) {
      return jsonError(422, error.code, error.message, requestId, {
        articles: error.articles,
      });
    }

    const providerStatus = geminiErrorStatus(error);
    if (providerStatus === 429) {
      return jsonError(
        429,
        "GEMINI_FREE_QUOTA_EXHAUSTED",
        publicGeminiErrorMessage(error),
        requestId
      );
    }

    if (providerStatus === 401 || providerStatus === 403) {
      return jsonError(
        providerStatus,
        "GEMINI_AUTH_ERROR",
        publicGeminiErrorMessage(error),
        requestId
      );
    }

    if (providerStatus === 504) {
      return jsonError(
        504,
        "GEMINI_TIMEOUT",
        publicGeminiErrorMessage(error),
        requestId
      );
    }

    if (providerStatus) {
      return jsonError(
        502,
        "GEMINI_UPSTREAM_ERROR",
        publicGeminiErrorMessage(error),
        requestId
      );
    }

    console.error("[gemini-briefing] request failed", {
      requestId,
      code: "GEMINI_BRIEFING_SERVER_ERROR",
      name: error?.name || "UnknownError",
    });

    return jsonError(
      500,
      "GEMINI_BRIEFING_SERVER_ERROR",
      "Gemini 브리핑 서버 함수 내부에서 오류가 발생했습니다. 요청 ID로 서버 로그를 확인해 주세요.",
      requestId
    );
  }
}
