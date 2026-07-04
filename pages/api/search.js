// 네이버 뉴스 검색 오픈API를 서버(백엔드)에서 호출하는 API Route
// - Client ID/Secret은 브라우저에 노출되면 안 되므로 반드시 서버 사이드에서만 호출합니다.
// - 네이버 API는 CORS를 허용하지 않기 때문에 프론트에서 직접 호출하면 실패합니다.

function stripHtml(text = "") {
  return text
    .replace(/<[^>]*>/g, "") // <b> 등 HTML 태그 제거
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "GET 요청만 지원합니다." });
  }

  const { query } = req.query;

  if (!query || !query.trim()) {
    return res.status(400).json({ message: "검색어(query)를 입력해주세요." });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      message:
        "서버에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되어 있지 않습니다.",
    });
  }

  const apiUrl = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(
    query
  )}&display=10&start=1&sort=date`; // sort=date: 최신순 정렬

  try {
    const naverRes = await fetch(apiUrl, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
    });

    if (!naverRes.ok) {
      const errorText = await naverRes.text();
      return res.status(naverRes.status).json({
        message: "네이버 뉴스 API 호출에 실패했습니다.",
        detail: errorText,
      });
    }

    const data = await naverRes.json();

    const items = (data.items || []).map((item) => ({
      title: stripHtml(item.title),
      description: stripHtml(item.description),
      link: item.originallink && item.originallink.trim() ? item.originallink : item.link,
      naverLink: item.link,
      pubDate: item.pubDate,
    }));

    return res.status(200).json({ items });
  } catch (error) {
    return res.status(500).json({
      message: "서버 오류가 발생했습니다.",
      detail: String(error),
    });
  }
}
