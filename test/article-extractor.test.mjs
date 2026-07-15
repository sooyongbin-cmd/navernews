import assert from "node:assert/strict";
import test from "node:test";

import {
  ArticleBatchError,
  extractArticleBatch,
  extractReadableArticleFromHtml,
  isPublicIp,
  validateTargetUrl,
} from "../lib/article-extractor.mjs";

function longParagraph(seed) {
  return `${seed} ` + "이 문장은 기사 전문 추출을 검증하기 위한 충분히 긴 본문입니다. ".repeat(8);
}

test("Readability로 세 문단 이상의 기사 전문 전체를 추출한다", () => {
  const html = `<!doctype html><html lang="ko"><head><title>테스트 뉴스</title></head>
    <body><nav>메뉴 광고 로그인</nav><article>
      <h1>테스트 뉴스 제목</h1>
      <p>${longParagraph("첫 번째 문단")}</p>
      <p>${longParagraph("두 번째 문단")}</p>
      <p>${longParagraph("세 번째 문단")}</p>
    </article></body></html>`;

  const article = extractReadableArticleFromHtml(
    html,
    "https://news.example.com/article"
  );

  assert.match(article.text, /첫 번째 문단/);
  assert.match(article.text, /두 번째 문단/);
  assert.match(article.text, /세 번째 문단/);
  assert.ok(article.text.length >= 500);
  assert.ok(article.paragraphCount >= 3);
});

test("사설·루프백·문서용 IP를 차단하고 공개 IP만 허용한다", () => {
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("2001:4860:4860::8888"), true);
  assert.equal(isPublicIp("127.0.0.1"), false);
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("169.254.1.1"), false);
  assert.equal(isPublicIp("192.0.2.1"), false);
  assert.equal(isPublicIp("::1"), false);
  assert.equal(isPublicIp("fc00::1"), false);
});

test("HTTP/HTTPS 80·443 이외의 URL을 거부한다", () => {
  assert.equal(validateTargetUrl("https://example.com/news").port, "");
  assert.throws(() => validateTargetUrl("http://example.com:3000/news"));
  assert.throws(() => validateTargetUrl("file:///etc/passwd"));
  assert.throws(() => validateTargetUrl("https://user:pass@example.com/news"));
});

test("세 기사 중 하나라도 실패하면 배치 전체를 실패 처리한다", async () => {
  const articles = [1, 2, 3].map((id) => ({
    id: String(id),
    originalLink: `https://news${id}.example.com/article`,
  }));
  let calls = 0;

  await assert.rejects(
    () =>
      extractArticleBatch(articles, async (url) => {
        calls += 1;
        if (url.includes("news2")) throw new Error("raw private error");
        return { text: "가".repeat(600) };
      }),
    (error) => {
      assert.ok(error instanceof ArticleBatchError);
      assert.equal(error.articles[0].status, "ready");
      assert.equal(error.articles[1].status, "failed");
      assert.equal(error.articles[1].reason.includes("raw private error"), false);
      return true;
    }
  );

  assert.equal(calls, 3);
});
