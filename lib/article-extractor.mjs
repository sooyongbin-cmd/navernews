import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";

import { Readability } from "@mozilla/readability";
import iconv from "iconv-lite";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import robotsParser from "robots-parser";

const ARTICLE_TIMEOUT_MS = 8_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 256 * 1024;
const MIN_ARTICLE_CHARS = 500;
const MAX_ARTICLE_CHARS = 50_000;
export const MAX_TOTAL_ARTICLE_CHARS = 120_000;
const MAX_REDIRECTS = 3;
const USER_AGENT_TOKEN = "NaverNewsBriefingBot";
const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+https://github.com/sooyongbin-cmd/navernews)`;

export class ArticleExtractionError extends Error {
  constructor(code, reason, { status } = {}) {
    super(reason);
    this.name = "ArticleExtractionError";
    this.code = code;
    this.reason = reason;
    this.status = status;
  }
}

export class ArticleBatchError extends Error {
  constructor(articles) {
    super("세 기사 전문을 모두 확보하지 못했습니다.");
    this.name = "ArticleBatchError";
    this.code = "ARTICLE_EXTRACTION_FAILED";
    this.articles = articles;
  }
}

export function isPublicIp(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }

    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export function validateTargetUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ArticleExtractionError(
      "INVALID_URL",
      "원문 URL 형식이 올바르지 않습니다."
    );
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ArticleExtractionError(
      "UNSUPPORTED_PROTOCOL",
      "HTTP 또는 HTTPS 원문만 확인할 수 있습니다."
    );
  }

  if (url.username || url.password) {
    throw new ArticleExtractionError(
      "URL_CREDENTIALS_BLOCKED",
      "인증 정보가 포함된 원문 URL은 확인할 수 없습니다."
    );
  }

  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!["80", "443"].includes(port)) {
    throw new ArticleExtractionError(
      "UNSUPPORTED_PORT",
      "80 또는 443 포트의 원문만 확인할 수 있습니다."
    );
  }

  return url;
}

async function resolvePublicAddresses(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ArticleExtractionError(
      "DNS_LOOKUP_FAILED",
      "원문 서버 주소를 확인할 수 없습니다."
    );
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new ArticleExtractionError(
      "PRIVATE_ADDRESS_BLOCKED",
      "공개 인터넷 주소가 아닌 원문 서버에는 접속할 수 없습니다."
    );
  }

  return addresses;
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    const requestedFamily = Number(options?.family) || 0;
    const candidates = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    const selected = candidates[0] || addresses[0];

    if (options?.all) {
      callback(
        null,
        (candidates.length ? candidates : addresses).map(({ address, family }) => ({
          address,
          family,
        }))
      );
      return;
    }

    callback(null, selected.address, selected.family);
  };
}

async function requestOnce(url, { timeoutMs, maxBytes }) {
  const addresses = await resolvePublicAddresses(url.hostname);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishWithError = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const request = transport.get(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "User-Agent": USER_AGENT,
        },
        lookup: pinnedLookup(addresses),
      },
      (response) => {
        const chunks = [];
        let totalBytes = 0;

        response.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            response.destroy();
            finishWithError(
              new ArticleExtractionError(
                "RESPONSE_TOO_LARGE",
                "원문 응답 크기가 허용 범위를 초과했습니다."
              )
            );
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });

        response.on("error", () => {
          finishWithError(
            new ArticleExtractionError(
              "RESPONSE_READ_FAILED",
              "원문 응답을 읽지 못했습니다."
            )
          );
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finishWithError(
        new ArticleExtractionError(
          "FETCH_TIMEOUT",
          "원문 서버 응답 시간이 초과되었습니다."
        )
      );
    });

    request.on("error", () => {
      finishWithError(
        new ArticleExtractionError(
          "FETCH_FAILED",
          "원문 서버에 접속하지 못했습니다."
        )
      );
    });
  });
}

async function safeHttpGet(
  value,
  { timeoutMs, maxBytes, maxRedirects = MAX_REDIRECTS, onBeforeRequest }
) {
  let currentUrl = validateTargetUrl(value);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (onBeforeRequest) {
      await onBeforeRequest(currentUrl.toString());
    }
    const response = await requestOnce(currentUrl, { timeoutMs, maxBytes });
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);

    if (!isRedirect) {
      return { ...response, url: currentUrl.toString() };
    }

    if (redirectCount === maxRedirects) {
      throw new ArticleExtractionError(
        "TOO_MANY_REDIRECTS",
        "원문 서버의 리다이렉트 횟수가 너무 많습니다."
      );
    }

    const location = response.headers.location;
    if (!location) {
      throw new ArticleExtractionError(
        "INVALID_REDIRECT",
        "원문 서버의 리다이렉트 주소가 올바르지 않습니다."
      );
    }

    currentUrl = validateTargetUrl(new URL(location, currentUrl).toString());
  }

  throw new ArticleExtractionError(
    "TOO_MANY_REDIRECTS",
    "원문 서버의 리다이렉트 횟수가 너무 많습니다."
  );
}

function headerValue(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function detectCharset(buffer, contentType) {
  const headerMatch = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i);
  if (headerMatch?.[1] && iconv.encodingExists(headerMatch[1])) {
    return headerMatch[1];
  }

  const prefix = buffer.subarray(0, 8_192).toString("ascii");
  const metaMatch = prefix.match(
    /<meta[^>]+charset\s*=\s*["']?([^\s"'/>;]+)/i
  );
  if (metaMatch?.[1] && iconv.encodingExists(metaMatch[1])) {
    return metaMatch[1];
  }

  const httpEquivMatch = prefix.match(
    /<meta[^>]+content=["'][^"']*charset=([^\s"';/>]+)/i
  );
  if (httpEquivMatch?.[1] && iconv.encodingExists(httpEquivMatch[1])) {
    return httpEquivMatch[1];
  }

  return "utf-8";
}

async function assertRobotsAllowed(articleUrl) {
  const parsedArticleUrl = validateTargetUrl(articleUrl);
  const robotsUrl = new URL("/robots.txt", parsedArticleUrl.origin).toString();
  let response;

  try {
    response = await safeHttpGet(robotsUrl, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: MAX_ROBOTS_BYTES,
      maxRedirects: 2,
    });
  } catch {
    throw new ArticleExtractionError(
      "ROBOTS_UNAVAILABLE",
      "언론사의 robots.txt를 확인할 수 없어 원문 조회를 중단했습니다."
    );
  }

  if ([404, 410].includes(response.status)) return;

  if ([401, 403].includes(response.status) || response.status >= 500) {
    throw new ArticleExtractionError(
      "ROBOTS_DISALLOWED",
      "언론사가 자동 원문 조회를 허용하지 않습니다."
    );
  }

  if (response.status < 200 || response.status >= 300) return;

  const rules = robotsParser(robotsUrl, response.body.toString("utf8"));
  if (rules.isAllowed(articleUrl, USER_AGENT_TOKEN) === false) {
    throw new ArticleExtractionError(
      "ROBOTS_DISALLOWED",
      "언론사의 robots.txt 정책상 원문을 조회할 수 없습니다."
    );
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

export function extractReadableArticleFromHtml(html, url) {
  let documentDom;
  let contentDom;

  try {
    documentDom = new JSDOM(html, { url });
    const article = new Readability(documentDom.window.document, {
      charThreshold: MIN_ARTICLE_CHARS,
    }).parse();

    if (!article?.textContent || !article?.content) {
      throw new ArticleExtractionError(
        "READABILITY_FAILED",
        "페이지에서 기사 본문을 식별하지 못했습니다."
      );
    }

    const fullText = normalizeText(article.textContent)
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .join("\n\n");

    contentDom = new JSDOM(`<body>${article.content}</body>`);
    const paragraphCount = Array.from(
      contentDom.window.document.querySelectorAll("p")
    ).filter((paragraph) => normalizeText(paragraph.textContent).length >= 20)
      .length;

    if (fullText.length < MIN_ARTICLE_CHARS || paragraphCount < 3) {
      throw new ArticleExtractionError(
        "ARTICLE_TOO_SHORT",
        "기사 전문으로 판단할 만큼 충분한 본문을 찾지 못했습니다."
      );
    }

    if (fullText.length > MAX_ARTICLE_CHARS) {
      throw new ArticleExtractionError(
        "ARTICLE_TOO_LONG",
        "기사 본문이 50,000자를 초과해 자르지 않고 중단했습니다."
      );
    }

    const paywallMarkers = [
      "로그인 후 이용",
      "구독자 전용",
      "유료 회원",
      "subscribe to continue",
      "sign in to continue",
      "subscriber-only",
    ];
    const opening = fullText.slice(0, 2_000).toLowerCase();
    if (
      fullText.length < 2_000 &&
      paywallMarkers.some((marker) => opening.includes(marker.toLowerCase()))
    ) {
      throw new ArticleExtractionError(
        "PAYWALL_DETECTED",
        "로그인 또는 구독이 필요한 기사라 전문을 확인할 수 없습니다."
      );
    }

    return {
      title: normalizeText(article.title),
      byline: normalizeText(article.byline),
      excerpt: normalizeText(article.excerpt),
      text: fullText,
      paragraphCount,
    };
  } finally {
    contentDom?.window.close();
    documentDom?.window.close();
  }
}

export async function fetchAndExtractArticle(articleUrl) {
  const response = await safeHttpGet(articleUrl, {
    timeoutMs: ARTICLE_TIMEOUT_MS,
    maxBytes: MAX_ARTICLE_BYTES,
    onBeforeRequest: assertRobotsAllowed,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new ArticleExtractionError(
      "ARTICLE_HTTP_ERROR",
      `원문 서버가 HTTP ${response.status} 상태를 반환했습니다.`,
      { status: response.status }
    );
  }

  const contentType = headerValue(response.headers, "content-type").toLowerCase();
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new ArticleExtractionError(
      "UNSUPPORTED_CONTENT_TYPE",
      "원문 응답이 HTML 문서가 아닙니다."
    );
  }

  const charset = detectCharset(response.body, contentType);
  const html = iconv.decode(response.body, charset);
  return {
    ...extractReadableArticleFromHtml(html, response.url),
    resolvedUrl: response.url,
  };
}

function safeFailureReason(error) {
  if (error instanceof ArticleExtractionError) return error.reason;
  return "원문 전문을 확인하지 못했습니다.";
}

export async function extractArticleBatch(
  articles,
  extractor = fetchAndExtractArticle
) {
  if (!Array.isArray(articles) || articles.length !== 3) {
    throw new ArticleBatchError([
      {
        id: "all",
        status: "failed",
        reason: "브리핑에는 정확히 3개의 기사가 필요합니다.",
      },
    ]);
  }

  const settled = await Promise.all(
    articles.map(async (article) => {
      try {
        const extracted = await extractor(article.originalLink);
        return { ok: true, article, extracted };
      } catch (error) {
        return { ok: false, article, error };
      }
    })
  );

  if (settled.some((result) => !result.ok)) {
    throw new ArticleBatchError(
      settled.map((result) => ({
        id: result.article.id,
        status: result.ok ? "ready" : "failed",
        reason: result.ok ? null : safeFailureReason(result.error),
      }))
    );
  }

  const extractedArticles = settled.map(({ article, extracted }) => ({
    ...article,
    ...extracted,
  }));
  const totalChars = extractedArticles.reduce(
    (sum, article) => sum + article.text.length,
    0
  );

  if (totalChars > MAX_TOTAL_ARTICLE_CHARS) {
    throw new ArticleBatchError(
      articles.map((article) => ({
        id: article.id,
        status: "failed",
        reason:
          "세 기사 본문 합계가 120,000자를 초과해 자르지 않고 중단했습니다.",
      }))
    );
  }

  return extractedArticles;
}
