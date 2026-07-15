import assert from "node:assert/strict";
import test from "node:test";

import {
  SEARCH_CANDIDATE_COUNT,
  SEARCH_RESULT_LIMIT,
  selectExtractableSearchArticles,
} from "../lib/search-article-selection.mjs";

function candidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `후보 기사 ${index + 1}`,
    description: `후보 설명 ${index + 1}`,
    originalLink: `https://news${index + 1}.example.com/article`,
    naverLink: `https://n.news.naver.com/article/${index + 1}`,
    pubDate: `2026-07-15T0${index}:00:00.000Z`,
  }));
}

test("최신 후보 중 전문 추출에 성공한 기사만 3건 선별한다", async () => {
  const calls = [];
  const selection = await selectExtractableSearchArticles(candidates(8), {
    extractor: async (url) => {
      calls.push(url);
      if (url.includes("news1.") || url.includes("news2.")) {
        throw new Error("추출 실패");
      }
      return { text: "가".repeat(600) };
    },
  });

  assert.equal(SEARCH_CANDIDATE_COUNT, 10);
  assert.equal(SEARCH_RESULT_LIMIT, 3);
  assert.equal(calls.length, 5);
  assert.equal(selection.complete, true);
  assert.equal(selection.checkedCount, 5);
  assert.equal(selection.excludedCount, 2);
  assert.deepEqual(
    selection.articles.map((article) => article.title),
    ["후보 기사 3", "후보 기사 4", "후보 기사 5"]
  );
  assert.deepEqual(
    selection.articles.map((article) => article.id),
    ["1", "2", "3"]
  );
  assert.ok(selection.articles.every((article) => article.fullTextAvailable));
  assert.ok(selection.articles.every((article) => !("text" in article)));
});

test("후보를 모두 확인해도 3건이 안 되면 확보된 기사만 반환한다", async () => {
  const selection = await selectExtractableSearchArticles(candidates(6), {
    extractor: async (url) => {
      if (!url.includes("news2.") && !url.includes("news6.")) {
        throw new Error("추출 실패");
      }
      return { text: "나".repeat(600) };
    },
  });

  assert.equal(selection.complete, false);
  assert.equal(selection.checkedCount, 6);
  assert.equal(selection.excludedCount, 4);
  assert.deepEqual(
    selection.articles.map((article) => article.title),
    ["후보 기사 2", "후보 기사 6"]
  );
});

test("세 기사 본문 합계 제한을 넘는 후보는 건너뛴다", async () => {
  const lengths = [50, 50, 30, 20];
  const selection = await selectExtractableSearchArticles(candidates(4), {
    batchSize: 4,
    maxTotalChars: 120,
    extractor: async (url) => {
      const match = url.match(/news(\d+)\./);
      return { text: "다".repeat(lengths[Number(match[1]) - 1]) };
    },
  });

  assert.equal(selection.complete, true);
  assert.deepEqual(
    selection.articles.map((article) => article.title),
    ["후보 기사 1", "후보 기사 2", "후보 기사 4"]
  );
});

test("원문 URL이 없거나 중복인 후보는 전문 확인 대상에서 제외한다", async () => {
  const input = candidates(3);
  input[0].originalLink = "";
  input[2].originalLink = input[1].originalLink;
  let calls = 0;

  const selection = await selectExtractableSearchArticles(input, {
    extractor: async () => {
      calls += 1;
      return { text: "라".repeat(600) };
    },
  });

  assert.equal(calls, 1);
  assert.equal(selection.checkedCount, 3);
  assert.equal(selection.excludedCount, 2);
  assert.equal(selection.articles.length, 1);
});
