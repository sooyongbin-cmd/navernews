import { createBriefingToken } from "@/lib/briefing-token.mjs";

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

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

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

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({
      message:
        "NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET 환경 변수를 설정해 주세요.",
    });
  }

  const apiUrl = new URL("https://openapi.naver.com/v1/search/news.json");
  apiUrl.search = new URLSearchParams({
    query,
    display: "3",
    start: "1",
    sort: "date",
  }).toString();

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 8_000);

  try {
    const naverResponse = await fetch(apiUrl, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      signal: abortController.signal,
    });

    if (!naverResponse.ok) {
      return res.status(naverResponse.status).json({
        message: "네이버 뉴스 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    const data = await naverResponse.json();
    const items = (data.items || []).slice(0, 3).map((item, index) => {
      const originalLink = String(item.originallink ?? "").trim();
      const naverLink = String(item.link ?? "").trim();

      return {
        id: String(index + 1),
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        originalLink: isHttpUrl(originalLink) ? originalLink : "",
        naverLink: isHttpUrl(naverLink) ? naverLink : "",
        pubDate: item.pubDate,
      };
    });

    let briefingToken = null;
    let expiresAt = null;
    const canCreateBriefing =
      items.length === 3 && items.every((item) => item.originalLink);

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
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        message: "네이버 뉴스 검색 응답 시간이 초과되었습니다.",
      });
    }

    if (error?.status === 500) {
      return res.status(500).json({ message: error.message });
    }

    return res.status(500).json({
      message: "뉴스 검색 중 서버 오류가 발생했습니다.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
