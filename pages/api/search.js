import { createBriefingToken } from "@/lib/briefing-token.mjs";
import {
  NewsSearchError,
  searchExtractableNews,
} from "@/lib/news-search.mjs";
import {
  SEARCH_RESULT_LIMIT,
} from "@/lib/search-article-selection.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "GET 요청만 지원합니다." });
  }

  const query = String(req.query.query ?? "").trim();
  if (!query) {
    return res.status(400).json({ message: "검색어를 입력해 주세요." });
  }

  if (query.length > 100) {
    return res
      .status(400)
      .json({ message: "검색어는 100자 이내로 입력해 주세요." });
  }

  try {
    const screening = await searchExtractableNews(query);
    const items = screening.articles;

    let briefingToken = null;
    let expiresAt = null;
    const canCreateBriefing =
      screening.complete &&
      items.length === SEARCH_RESULT_LIMIT &&
      items.every((item) => item.originalLink);

    if (canCreateBriefing) {
      const signed = createBriefingToken({ query, articles: items });
      briefingToken = signed.token;
      expiresAt = signed.expiresAt;
    }

    return res.status(200).json({
      query,
      items,
      briefingToken,
      expiresAt,
      screening: {
        checkedCount: screening.checkedCount,
        excludedCount: screening.excludedCount,
        complete: screening.complete,
      },
    });
  } catch (error) {
    if (error instanceof NewsSearchError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    if (error?.status === 500) {
      return res.status(500).json({ message: error.message });
    }

    return res.status(500).json({
      message: "뉴스 검색 및 기사 전문 확인 중 서버 오류가 발생했습니다.",
    });
  }
}
