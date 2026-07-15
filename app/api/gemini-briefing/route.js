import { randomUUID } from "node:crypto";

import { GoogleGenAI } from "@google/genai";

import {
  ArticleBatchError,
} from "@/lib/article-extractor.mjs";
import {
  buildGeminiClientOptions,
  buildGeminiInteractionRequest,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_TIMEOUT_MS,
  geminiStreamError,
  geminiTextDelta,
  hasRequiredSourceCitations,
  startGeminiBriefing,
  startGeminiBriefingFromExtractedArticles,
} from "@/lib/gemini-briefing.mjs";
import {
  geminiErrorCode,
  geminiErrorStatus,
  publicGeminiErrorMessage,
} from "@/lib/gemini-errors.mjs";
import {
  createGeminiInfographicSplitter,
  parseGeminiInfographicBlock,
} from "@/lib/gemini-infographic.mjs";
import {
  BriefingTokenError,
  createBriefingToken,
} from "@/lib/briefing-token.mjs";
import {
  NewsSearchError,
  searchExtractableNews,
} from "@/lib/news-search.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    geminiClient = new GoogleGenAI(buildGeminiClientOptions(apiKey));
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
      let briefingText = "";
      const splitter = createGeminiInfographicSplitter();

      try {
        for await (const event of stream) {
          const providerError = geminiStreamError(event);
          if (providerError) throw providerError;

          const text = geminiTextDelta(event);
          if (!text) continue;

          const briefingDelta = splitter.push(text);
          if (!briefingDelta) continue;

          briefingText += briefingDelta;
          controller.enqueue(
            encoder.encode(sseEvent("delta", { text: briefingDelta }))
          );
        }

        const completedOutput = splitter.finish();
        if (completedOutput.briefingText) {
          briefingText += completedOutput.briefingText;
          controller.enqueue(
            encoder.encode(
              sseEvent("delta", { text: completedOutput.briefingText })
            )
          );
        }

        if (!briefingText.trim()) {
          const error = new Error("Gemini returned an empty response.");
          error.code = "GEMINI_EMPTY_RESPONSE";
          throw error;
        }

        if (!hasRequiredSourceCitations(briefingText)) {
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

        let infographic;
        try {
          infographic = parseGeminiInfographicBlock(
            completedOutput.infographicBlock
          );
        } catch (error) {
          console.error("[gemini-briefing] infographic validation failed", {
            requestId,
            code: "GEMINI_INFOGRAPHIC_VALIDATION_FAILED",
            name: error?.name || "UnknownError",
          });
          controller.enqueue(
            encoder.encode(
              sseEvent("error", {
                code: "GEMINI_INFOGRAPHIC_VALIDATION_FAILED",
                message:
                  "Gemini가 SVG 인포그래픽에 필요한 형식을 지키지 않아 결과를 표시하지 않았습니다. 다시 시도해 주세요.",
                status: 502,
                requestId,
              })
            )
          );
          return;
        }

        controller.enqueue(
          encoder.encode(sseEvent("infographic", { infographic }))
        );

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
          providerCode: error?.providerCode || error?.code || null,
          name: error?.name || "UnknownError",
          status,
        });

        controller.enqueue(
          encoder.encode(
            sseEvent("error", {
              code,
              message,
              status,
              requestId,
              providerCode: error?.providerCode || error?.code || null,
            })
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

function automaticStreamError(error, requestId) {
  if (error instanceof NewsSearchError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      requestId,
    };
  }

  if (error instanceof GeminiConfigurationError) {
    return {
      code: error.code,
      message: error.message,
      status: 500,
      requestId,
    };
  }

  if (error instanceof BriefingTokenError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      requestId,
    };
  }

  const providerStatus = geminiErrorStatus(error);
  if (providerStatus) {
    const code =
      providerStatus === 429
        ? "GEMINI_FREE_QUOTA_EXHAUSTED"
        : providerStatus === 401 || providerStatus === 403
          ? "GEMINI_AUTH_ERROR"
          : providerStatus === 504
            ? "GEMINI_TIMEOUT"
            : "GEMINI_UPSTREAM_ERROR";
    return {
      code,
      providerCode: error?.providerCode || error?.code || null,
      message: publicGeminiErrorMessage(error),
      status:
        providerStatus === 429 ||
        providerStatus === 401 ||
        providerStatus === 403 ||
        providerStatus === 504
          ? providerStatus
          : 502,
      requestId,
    };
  }

  return {
    code: "GEMINI_BRIEFING_SERVER_ERROR",
    message:
      "자동 Gemini 브리핑 서버 함수 내부에서 오류가 발생했습니다. 요청 ID로 서버 로그를 확인해 주세요.",
    status: 500,
    requestId,
  };
}

function streamAutomaticGeminiSearch(query, requestId, requestSignal) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        const search = await searchExtractableNews(query, {
          signal: requestSignal,
        });
        const items = search.articles;
        let briefingToken = null;
        let expiresAt = null;

        if (search.complete) {
          const signed = createBriefingToken({
            query: search.query,
            articles: items,
          });
          briefingToken = signed.token;
          expiresAt = signed.expiresAt;
        }

        controller.enqueue(
          encoder.encode(
            sseEvent("search", {
              query: search.query,
              items,
              briefingToken,
              expiresAt,
              screening: {
                checkedCount: search.checkedCount,
                excludedCount: search.excludedCount,
                complete: search.complete,
              },
            })
          )
        );

        if (!search.complete) {
          controller.enqueue(
            encoder.encode(
              sseEvent("complete", { requestId, skipped: true })
            )
          );
          return;
        }

        const model = configuredModel();
        const client = getGeminiClient();
        const { stream } = await startGeminiBriefingFromExtractedArticles({
          query: search.query,
          articles: search.extractedArticles,
          createInteraction({ prompt }) {
            return client.interactions.create(
              buildGeminiInteractionRequest({ model, prompt }),
              {
                timeout: GEMINI_MODEL_TIMEOUT_MS,
                fetchOptions: { signal: requestSignal },
                maxRetries: 0,
              }
            );
          },
        });
        const geminiResponse = streamGeminiResponse(stream, requestId);
        const reader = geminiResponse.body.getReader();

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        const details = automaticStreamError(error, requestId);
        console.error("[gemini-briefing] automatic search failed", {
          requestId,
          code: details.code,
          providerCode: details.providerCode || null,
          name: error?.name || "UnknownError",
          status: details.status,
        });
        controller.enqueue(encoder.encode(sseEvent("error", details)));
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

  if (Object.prototype.hasOwnProperty.call(requestBody || {}, "query")) {
    const query = String(requestBody?.query ?? "").trim();
    if (!query || query.length > 100) {
      return jsonError(
        400,
        "INVALID_SEARCH_QUERY",
        query
          ? "검색어는 100자 이내로 입력해 주세요."
          : "검색어를 입력해 주세요.",
        requestId
      );
    }

    return streamAutomaticGeminiSearch(query, requestId, request.signal);
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
