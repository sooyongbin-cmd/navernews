import assert from "node:assert/strict";
import test from "node:test";

import {
  geminiErrorCode,
  geminiErrorStatus,
  publicGeminiErrorMessage,
} from "../lib/gemini-errors.mjs";

test("Gemini 무료 한도 오류를 429로 분류한다", () => {
  const error = new Error("RESOURCE_EXHAUSTED: quota exceeded");
  assert.equal(geminiErrorStatus(error), 429);
  assert.equal(geminiErrorCode(error), "GEMINI_FREE_QUOTA_EXHAUSTED");
  assert.match(publicGeminiErrorMessage(error), /무료 API 호출 한도/);
});

test("Gemini 인증 오류를 구체적으로 분류한다", () => {
  const error = Object.assign(new Error("API key not valid"), { status: 403 });
  assert.equal(geminiErrorStatus(error), 403);
  assert.equal(geminiErrorCode(error), "GEMINI_AUTH_ERROR");
  assert.match(publicGeminiErrorMessage(error), /GEMINI_API_KEY/);
});

test("Gemini 시간 초과를 504로 분류한다", () => {
  const error = Object.assign(new Error("request timed out"), {
    name: "AbortError",
  });
  assert.equal(geminiErrorStatus(error), 504);
  assert.equal(geminiErrorCode(error), "GEMINI_TIMEOUT");
});
