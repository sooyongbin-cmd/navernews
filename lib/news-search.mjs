import {
  SEARCH_CANDIDATE_COUNT,
  selectExtractableSearchArticles,
} from "./search-article-selection.mjs";

const NAVER_SEARCH_TIMEOUT_MS = 8_000;

export class NewsSearchError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "NewsSearchError";
    this.code = code;
    this.status = status;
  }
}

function stripHtml(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) =>
      String.fromCodePoint(Number.parseInt(value, 16))
    );
}

function httpUrl(value) {
  try {
    const parsed = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(parsed.protocol)
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

export async function searchExtractableNews(
  query,
  {
    clientId = process.env.NAVER_CLIENT_ID,
    clientSecret = process.env.NAVER_CLIENT_SECRET,
    fetchImpl = fetch,
    selectArticles = selectExtractableSearchArticles,
    signal,
  } = {}
) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new NewsSearchError(
      "INVALID_SEARCH_QUERY",
      "검색어를 입력해 주세요.",
      400
    );
  }
  if (normalizedQuery.length > 100) {
    throw new NewsSearchError(
      "INVALID_SEARCH_QUERY",
      "검색어는 100자 이내로 입력해 주세요.",
      400
    );
  }
  if (!clientId || !clientSecret) {
    throw new NewsSearchError(
      "NAVER_CONFIGURATION_ERROR",
      "NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET 환경 변수를 설정해 주세요.",
      500
    );
  }

  const apiUrl = new URL("https://openapi.naver.com/v1/search/news.json");
  apiUrl.search = new URLSearchParams({
    query: normalizedQuery,
    display: String(SEARCH_CANDIDATE_COUNT),
    start: "1",
    sort: "date",
  }).toString();

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), NAVER_SEARCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(apiUrl, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new NewsSearchError(
        "NAVER_SEARCH_ERROR",
        "네이버 뉴스 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        response.status
      );
    }

    const data = await response.json();
    clearTimeout(timeout);
    const candidates = (data.items || [])
      .slice(0, SEARCH_CANDIDATE_COUNT)
      .map((item, index) => ({
        id: String(index + 1),
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        originalLink: httpUrl(item.originallink),
        naverLink: httpUrl(item.link),
        pubDate: item.pubDate,
      }));
    const selection = await selectArticles(candidates);

    return {
      query: normalizedQuery,
      ...selection,
    };
  } catch (error) {
    if (error instanceof NewsSearchError) throw error;
    if (error?.name === "AbortError" || controller.signal.aborted) {
      if (signal?.aborted) throw error;
      throw new NewsSearchError(
        "NAVER_SEARCH_TIMEOUT",
        "네이버 뉴스 검색 응답 시간이 초과되었습니다.",
        504
      );
    }
    throw new NewsSearchError(
      "NEWS_SEARCH_SERVER_ERROR",
      "뉴스 검색 및 기사 전문 확인 중 서버 오류가 발생했습니다.",
      500
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
