import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeminiClientOptions,
  buildGeminiInteractionRequest,
  DEFAULT_GEMINI_MODEL,
  geminiStreamError,
  geminiTextDelta,
  hasRequiredSourceCitations,
  startGeminiBriefing,
} from "../lib/gemini-briefing.mjs";
import { INFOGRAPHIC_START_MARKER } from "../lib/gemini-infographic.mjs";

test("Gemini 요청은 무료 모델과 비저장 스트리밍 설정으로 고정된다", () => {
  const request = buildGeminiInteractionRequest({
    prompt: "세 기사 전문",
    systemPrompt: "시스템 지침",
  });

  assert.deepEqual(request, {
    model: DEFAULT_GEMINI_MODEL,
    input: "세 기사 전문",
    system_instruction: "시스템 지침",
    stream: true,
    store: false,
    generation_config: {
      temperature: 0.2,
      thinking_level: "low",
      max_output_tokens: 1_800,
    },
  });
  assert.equal("tools" in request, false);
});

test("Gemini SDK는 Interactions 기본 API 버전을 사용한다", () => {
  const options = buildGeminiClientOptions("test-api-key");

  assert.deepEqual(options, { apiKey: "test-api-key" });
  assert.equal("apiVersion" in options, false);
  assert.equal("httpOptions" in options, false);
});

test("세 기사 전문을 모두 포함해 Gemini를 정확히 한 번 호출한다", async () => {
  const fullTexts = [
    "첫 번째 기사 전체 본문 UNIQUE_SOURCE_ONE",
    "두 번째 기사 전체 본문 UNIQUE_SOURCE_TWO",
    "세 번째 기사 전체 본문 UNIQUE_SOURCE_THREE",
  ];
  let interactionCalls = 0;
  let receivedPrompt = "";
  const expectedStream = (async function* () {
    yield { event_type: "step.delta", delta: { type: "text", text: "ok" } };
  })();

  const result = await startGeminiBriefing({
    briefingToken: "signed-token",
    verifyToken(token) {
      assert.equal(token, "signed-token");
      return {
        query: "테스트",
        articles: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };
    },
    async extractArticles(articles) {
      assert.equal(articles.length, 3);
      return articles.map((article, index) => ({
        ...article,
        title: `기사 ${article.id}`,
        pubDate: "2026-07-15T00:00:00.000Z",
        text: fullTexts[index],
      }));
    },
    async createInteraction({ prompt }) {
      interactionCalls += 1;
      receivedPrompt = prompt;
      return expectedStream;
    },
  });

  assert.equal(interactionCalls, 1);
  assert.equal(result.stream, expectedStream);
  for (const fullText of fullTexts) {
    assert.equal(receivedPrompt.split(fullText).length - 1, 1);
  }
  assert.match(receivedPrompt, new RegExp(INFOGRAPHIC_START_MARKER));
  assert.match(receivedPrompt, /추가 API 호출 없이 SVG 인포그래픽/);
});

test("전문 추출이 실패하면 Gemini를 호출하지 않는다", async () => {
  let interactionCalls = 0;
  const extractionError = new Error("ARTICLE_EXTRACTION_FAILED");

  await assert.rejects(
    startGeminiBriefing({
      briefingToken: "signed-token",
      verifyToken() {
        return { query: "테스트", articles: [{ id: 1 }] };
      },
      async extractArticles() {
        throw extractionError;
      },
      async createInteraction() {
        interactionCalls += 1;
      },
    }),
    extractionError
  );

  assert.equal(interactionCalls, 0);
});

test("Gemini 스트림에서는 텍스트 델타만 추출한다", () => {
  assert.equal(
    geminiTextDelta({
      event_type: "step.delta",
      delta: { type: "text", text: "브리핑" },
    }),
    "브리핑"
  );
  assert.equal(
    geminiTextDelta({
      event_type: "step.delta",
      delta: { type: "thought_summary", text: "내부 추론" },
    }),
    ""
  );
});

test("Gemini 스트림 오류 이벤트를 예외로 변환한다", () => {
  const error = geminiStreamError({
    event_type: "error",
    error: { code: "RESOURCE_EXHAUSTED", message: "quota exceeded" },
  });

  assert.equal(error.code, "RESOURCE_EXHAUSTED");
  assert.equal(error.providerCode, "RESOURCE_EXHAUSTED");
  assert.match(error.message, /quota exceeded/);
});

test("완성된 브리핑은 세 출처 번호를 모두 포함해야 한다", () => {
  assert.equal(hasRequiredSourceCitations("사실 [1] 비교 [2] 결론 [3]"), true);
  assert.equal(hasRequiredSourceCitations("사실 [1] 비교 [2]"), false);
});
