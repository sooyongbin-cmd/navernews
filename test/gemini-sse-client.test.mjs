import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeGeminiSse,
  GeminiSseError,
} from "../lib/gemini-sse-client.mjs";

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
    'event: complete\ndata: {"requestId":"req-1"}\n\n',
  ]);
  let text = "";

  const completion = await consumeGeminiSse(response, {
    onDelta(delta) {
      text += delta;
    },
  });

  assert.equal(text, "첫째 둘째");
  assert.equal(completion.requestId, "req-1");
});

test("SSE 오류 이벤트의 상세 정보를 보존한다", async () => {
  const response = responseFromChunks([
    'event: error\ndata: {"code":"GEMINI_AUTH_ERROR","message":"인증 실패","status":403,"requestId":"req-2"}\n\n',
  ]);

  await assert.rejects(
    consumeGeminiSse(response),
    (error) =>
      error instanceof GeminiSseError &&
      error.details.code === "GEMINI_AUTH_ERROR" &&
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
