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
    'event: search\ndata: {"query":"AI","items":[{"id":"1"},{"id":"2"},{"id":"3"}],"screening":{"complete":true}}\n\n',
    'event: delta\ndata: {"text":"첫째 "}\n',
    '\nevent: delta\ndata: {"text":"둘째"}\n\n',
    `event: infographic\ndata: ${JSON.stringify({ infographic: INFOGRAPHIC })}\n\n`,
    'event: complete\ndata: {"requestId":"req-1"}\n\n',
  ]);
  let text = "";
  let infographic = null;
  let search = null;

  const completion = await consumeGeminiSse(response, {
    onSearch(value) {
      search = value;
    },
    onDelta(delta) {
      text += delta;
    },
    onInfographic(value) {
      infographic = value;
    },
  });

  assert.equal(text, "첫째 둘째");
  assert.equal(completion.requestId, "req-1");
  assert.equal(search.query, "AI");
  assert.equal(search.items.length, 3);
  assert.equal(completion.search.query, "AI");
  assert.deepEqual(infographic, INFOGRAPHIC);
  assert.deepEqual(completion.infographic, INFOGRAPHIC);
});

test("전문 확보가 3건 미만이면 인포그래픽 없이 자동 브리핑을 생략한다", async () => {
  const response = responseFromChunks([
    'event: search\ndata: {"query":"제한","items":[{"id":"1"},{"id":"2"}],"screening":{"complete":false}}\n\n',
    'event: complete\ndata: {"requestId":"req-skip","skipped":true}\n\n',
  ]);
  let search = null;

  const completion = await consumeGeminiSse(response, {
    onSearch(value) {
      search = value;
    },
  });

  assert.equal(search.items.length, 2);
  assert.equal(completion.skipped, true);
  assert.equal(completion.infographic, null);
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
