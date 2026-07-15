import { createHmac, timingSafeEqual } from "node:crypto";

export const BRIEFING_TOKEN_TTL_MS = 5 * 60 * 1000;

export class BriefingTokenError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BriefingTokenError";
    this.code = code;
    this.status = status;
  }
}

function getSigningSecret(secret) {
  const value = secret ?? process.env.BRIEFING_SIGNING_SECRET;

  if (typeof value !== "string" || value.length < 32) {
    throw new BriefingTokenError(
      "BRIEFING_CONFIG_ERROR",
      "BRIEFING_SIGNING_SECRET은 32자 이상으로 설정해야 합니다.",
      500
    );
  }

  return value;
}

function normalizeArticles(articles) {
  if (!Array.isArray(articles) || articles.length !== 3) {
    throw new BriefingTokenError(
      "INVALID_ARTICLE_COUNT",
      "브리핑에는 정확히 3개의 기사가 필요합니다."
    );
  }

  return articles.map((article, index) => {
    const originalLink = String(article?.originalLink ?? "").trim();
    let parsedUrl;

    try {
      parsedUrl = new URL(originalLink);
    } catch {
      throw new BriefingTokenError(
        "INVALID_ARTICLE_URL",
        `${index + 1}번 기사의 원문 URL이 올바르지 않습니다.`
      );
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new BriefingTokenError(
        "INVALID_ARTICLE_URL",
        `${index + 1}번 기사의 원문 URL 프로토콜을 지원하지 않습니다.`
      );
    }

    return {
      id: String(index + 1),
      title: String(article?.title ?? "").slice(0, 500),
      originalLink: parsedUrl.toString(),
      naverLink: String(article?.naverLink ?? "").slice(0, 2048),
      pubDate: String(article?.pubDate ?? "").slice(0, 100),
    };
  });
}

function sign(encodedPayload, secret) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createBriefingToken({
  query,
  articles,
  now = Date.now(),
  secret,
}) {
  const normalizedQuery = String(query ?? "").trim().slice(0, 200);
  const signingSecret = getSigningSecret(secret);
  const expiresAtMs = now + BRIEFING_TOKEN_TTL_MS;
  const payload = {
    v: 1,
    query: normalizedQuery,
    articles: normalizeArticles(articles),
    exp: expiresAtMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = sign(encodedPayload, signingSecret);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifyBriefingToken(token, { now = Date.now(), secret } = {}) {
  if (typeof token !== "string" || token.length > 16_000) {
    throw new BriefingTokenError(
      "INVALID_BRIEFING_TOKEN",
      "브리핑 요청 정보가 올바르지 않습니다. 다시 검색해 주세요."
    );
  }

  const [encodedPayload, suppliedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra.length > 0) {
    throw new BriefingTokenError(
      "INVALID_BRIEFING_TOKEN",
      "브리핑 요청 정보가 올바르지 않습니다. 다시 검색해 주세요."
    );
  }

  const signingSecret = getSigningSecret(secret);
  const expectedSignature = sign(encodedPayload, signingSecret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const suppliedBuffer = Buffer.from(suppliedSignature);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw new BriefingTokenError(
      "INVALID_BRIEFING_TOKEN",
      "브리핑 요청 정보가 변조되었습니다. 다시 검색해 주세요."
    );
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new BriefingTokenError(
      "INVALID_BRIEFING_TOKEN",
      "브리핑 요청 정보를 읽을 수 없습니다. 다시 검색해 주세요."
    );
  }

  if (payload?.v !== 1 || !Number.isFinite(payload?.exp)) {
    throw new BriefingTokenError(
      "INVALID_BRIEFING_TOKEN",
      "지원하지 않는 브리핑 요청입니다. 다시 검색해 주세요."
    );
  }

  if (payload.exp <= now) {
    throw new BriefingTokenError(
      "EXPIRED_BRIEFING_TOKEN",
      "브리핑 요청이 만료되었습니다. 다시 검색해 주세요."
    );
  }

  return {
    ...payload,
    query: String(payload.query ?? "").slice(0, 200),
    articles: normalizeArticles(payload.articles),
  };
}
