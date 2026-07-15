import assert from "node:assert/strict";
import test from "node:test";

import {
  NewsSearchError,
  searchExtractableNews,
} from "../lib/news-search.mjs";

test("네이버 후보 10건을 요청하고 정제된 후보를 전문 선별기에 전달한다", async () => {
  let requestedUrl = null;
  let selectedCandidates = null;
  const result = await searchExtractableNews("AI 정책", {
    clientId: "client-id",
    clientSecret: "client-secret",
    async fetchImpl(url, options) {
      requestedUrl = new URL(url);
      assert.equal(options.headers["X-Naver-Client-Id"], "client-id");
      return Response.json({
        items: Array.from({ length: 10 }, (_, index) => ({
          title: `<b>기사 ${index + 1}</b>`,
          description: `설명 &amp; ${index + 1}`,
          originallink: `https://news${index + 1}.example.com/article`,
          link: `https://n.news.naver.com/article/${index + 1}`,
          pubDate: "Wed, 15 Jul 2026 00:00:00 +0900",
        })),
      });
    },
    async selectArticles(candidates) {
      selectedCandidates = candidates;
      return {
        articles: candidates.slice(0, 3),
        extractedArticles: candidates.slice(0, 3).map((article) => ({
          ...article,
          text: "전문",
        })),
        checkedCount: 3,
        excludedCount: 0,
        complete: true,
      };
    },
  });

  assert.equal(requestedUrl.searchParams.get("display"), "10");
  assert.equal(requestedUrl.searchParams.get("sort"), "date");
  assert.equal(selectedCandidates.length, 10);
  assert.equal(selectedCandidates[0].title, "기사 1");
  assert.equal(selectedCandidates[0].description, "설명 & 1");
  assert.equal(result.extractedArticles.length, 3);
});

test("네이버 검색 오류를 공개 가능한 오류로 변환한다", async () => {
  await assert.rejects(
    searchExtractableNews("오류", {
      clientId: "client-id",
      clientSecret: "client-secret",
      async fetchImpl() {
        return new Response("denied", { status: 403 });
      },
    }),
    (error) =>
      error instanceof NewsSearchError &&
      error.code === "NAVER_SEARCH_ERROR" &&
      error.status === 403 &&
      !error.message.includes("denied")
  );
});
