import assert from "node:assert/strict";
import test from "node:test";

import {
  BriefingTokenError,
  createBriefingToken,
  verifyBriefingToken,
} from "../lib/briefing-token.mjs";

const secret = "test-secret-that-is-longer-than-thirty-two-characters";
const articles = [1, 2, 3].map((id) => ({
  id: String(id),
  title: `기사 ${id}`,
  originalLink: `https://news${id}.example.com/article`,
  naverLink: `https://n.news.naver.com/${id}`,
  pubDate: "Wed, 15 Jul 2026 10:00:00 +0900",
}));

test("브리핑 토큰은 3개 기사와 5분 만료 정보를 검증한다", () => {
  const now = Date.UTC(2026, 6, 15, 0, 0, 0);
  const signed = createBriefingToken({ articles, query: "인공지능", now, secret });
  const payload = verifyBriefingToken(signed.token, { now: now + 1_000, secret });

  assert.equal(payload.query, "인공지능");
  assert.equal(payload.articles.length, 3);
  assert.equal(payload.articles[2].id, "3");
  assert.equal(new Date(signed.expiresAt).getTime(), now + 5 * 60 * 1_000);
});

test("변조되거나 만료된 브리핑 토큰은 거부한다", () => {
  const now = Date.UTC(2026, 6, 15, 0, 0, 0);
  const { token } = createBriefingToken({ articles, query: "경제", now, secret });

  assert.throws(
    () => verifyBriefingToken(`${token}x`, { now, secret }),
    (error) =>
      error instanceof BriefingTokenError &&
      error.code === "INVALID_BRIEFING_TOKEN"
  );
  assert.throws(
    () => verifyBriefingToken(token, { now: now + 5 * 60 * 1_000, secret }),
    (error) =>
      error instanceof BriefingTokenError &&
      error.code === "EXPIRED_BRIEFING_TOKEN"
  );
});

test("서명 토큰에는 기사 전문이 포함되지 않는다", () => {
  const marker = "DO-NOT-PERSIST-FULL-ARTICLE";
  const { token } = createBriefingToken({
    articles: articles.map((article) => ({ ...article, text: marker })),
    query: "보안",
    secret,
  });

  const encodedPayload = token.split(".")[0];
  const decodedPayload = Buffer.from(encodedPayload, "base64url").toString();
  assert.equal(decodedPayload.includes(marker), false);
});
