import assert from "node:assert/strict";
import test from "node:test";

import {
  briefingFailureFromResponse,
  briefingNetworkFailure,
  briefingStreamFailure,
} from "../lib/briefing-client-error.mjs";

test("JSON API 오류의 코드와 기사별 사유, 요청 ID를 보존한다", async () => {
  const response = Response.json(
    {
      code: "ARTICLE_EXTRACTION_FAILED",
      message: "세 기사 전문을 모두 확보하지 못했습니다.",
      articles: [{ id: "2", status: "failed", reason: "HTTP 403" }],
    },
    {
      status: 422,
      headers: { "X-Briefing-Request-Id": "request-json" },
    }
  );

  const failure = await briefingFailureFromResponse(response);

  assert.equal(failure.code, "ARTICLE_EXTRACTION_FAILED");
  assert.equal(failure.status, 422);
  assert.equal(failure.requestId, "request-json");
  assert.equal(failure.articles[0].reason, "HTTP 403");
});

test("Vercel 비JSON 시간 초과 응답을 구체적인 원인으로 변환한다", async () => {
  const response = new Response("<h1>FUNCTION_INVOCATION_TIMEOUT</h1>", {
    status: 504,
    statusText: "Gateway Timeout",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Vercel-Id": "icn1::timeout-request",
    },
  });

  const failure = await briefingFailureFromResponse(response);

  assert.equal(failure.code, "BRIEFING_HTTP_504");
  assert.match(failure.message, /Vercel 함수 실행 시간이 초과/);
  assert.equal(failure.requestId, "icn1::timeout-request");
  assert.equal(failure.responseType, "text/html");
  assert.doesNotMatch(failure.message, /<h1>/);
});

test("네트워크 연결 실패와 요청 취소를 구분한다", () => {
  assert.equal(
    briefingNetworkFailure(new TypeError("fetch failed")).code,
    "BRIEFING_NETWORK_ERROR"
  );
  assert.equal(
    briefingNetworkFailure({ name: "AbortError" }).code,
    "BRIEFING_REQUEST_ABORTED"
  );
});

test("AI 스트림의 구조화된 오류 정보를 복원한다", () => {
  const failure = briefingStreamFailure(
    new Error(
      JSON.stringify({
        code: "AI_GATEWAY_AUTH_ERROR",
        message: "AI Gateway 인증을 확인할 수 없습니다.",
        status: 401,
        requestId: "request-stream",
        actionUrl: "https://vercel.com/example-action",
      })
    )
  );

  assert.equal(failure.code, "AI_GATEWAY_AUTH_ERROR");
  assert.equal(failure.status, 401);
  assert.equal(failure.requestId, "request-stream");
  assert.equal(failure.actionUrl, "https://vercel.com/example-action");
});
