import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeGeminiSse,
  GeminiSseError,
} from "../lib/gemini-sse-client.mjs";

const INFOGRAPHIC = {
  title: "핵심 뉴스 요약",
  summary: "세 기사에서 확인한 사실과 차이를 시각적으로 정리했습니다.",
  keywords: ["사실", "차이", "확인"],
  points: [
    { kind: "common", text: "세 기사의 공통 사실", sources: [1, 2, 3] },
    { kind: "difference", text: "기사별 관점 차이", sources: [1, 2] },
    { kind: "uncertain", text: "추가 확인이 필요한 내용", sources: [2, 3] },
  ],
  theme: "blue",
};

function responseFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

test("분할된 SSE 델타를 순서대로 합치고 완료 이벤트를 반환한다", async () => {
  const response = responseFromChunks([
    'event: delta\ndata: {"text":"첫째 "}\n',
    '\nevent: delta\ndata: {"text":"둘째"}\n\n',
    `event: infographic\ndata: ${JSON.stringify({ infographic: INFOGRAPHIC })}\n\n`,
    'event: complete\ndata: {"requestId":"req-1"}\n\n',
  ]);
  let text = "";
  let infographic = null;

  const completion = await consumeGeminiSse(response, {
    onDelta(delta) {
      text += delta;
    },
    onInfographic(value) {
      infographic = value;
    },
  });

  assert.equal(text, "첫째 둘째");
  assert.equal(completion.requestId, "req-1");
  assert.deepEqual(infographic, INFOGRAPHIC);
  assert.deepEqual(completion.infographic, INFOGRAPHIC);
});

test("SSE 오류 이벤트의 상세 정보를 보존한다", async () => {
  const response = responseFromChunks([
    'event: error\ndata: {"code":"GEMINI_AUTH_ERROR","providerCode":"PERMISSION_DENIED","message":"인증 실패","status":403,"requestId":"req-2"}\n\n',
  ]);

  await assert.rejects(
    consumeGeminiSse(response),
    (error) =>
      error instanceof GeminiSseError &&
      error.details.code === "GEMINI_AUTH_ERROR" &&
      error.details.providerCode === "PERMISSION_DENIED" &&
      error.details.status === 403
  );
});

test("완료 이벤트 없이 종료된 스트림을 실패 처리한다", async () => {
  const response = responseFromChunks([
    'event: delta\ndata: {"text":"미완성"}\n\n',
  ]);

  await assert.rejects(
    consumeGeminiSse(response),
    (error) => error?.details?.code === "GEMINI_STREAM_INCOMPLETE"
  );
});

test("완료 이벤트에 인포그래픽이 없으면 실패 처리한다", async () => {
  const response = responseFromChunks([
    'event: delta\ndata: {"text":"브리핑"}\n\n',
    'event: complete\ndata: {"requestId":"req-3"}\n\n',
  ]);

  await assert.rejects(
    consumeGeminiSse(response),
    (error) => error?.details?.code === "GEMINI_INFOGRAPHIC_MISSING"
  );
});
