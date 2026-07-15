import {
  fetchAndExtractArticle,
  MAX_TOTAL_ARTICLE_CHARS,
} from "./article-extractor.mjs";

export const SEARCH_RESULT_LIMIT = 3;
export const SEARCH_CANDIDATE_COUNT = 10;
export const SEARCH_EXTRACTION_BATCH_SIZE = 5;

function normalizedOriginalLink(article) {
  const value = String(article?.originalLink ?? "").trim();
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function selectExtractableSearchArticles(
  candidates,
  {
    extractor = fetchAndExtractArticle,
    limit = SEARCH_RESULT_LIMIT,
    batchSize = SEARCH_EXTRACTION_BATCH_SIZE,
    maxTotalChars = MAX_TOTAL_ARTICLE_CHARS,
  } = {}
) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("Search article candidates must be an array.");
  }

  const safeLimit = Math.max(1, Math.min(SEARCH_RESULT_LIMIT, Number(limit) || 0));
  const safeBatchSize = Math.max(1, Math.min(10, Number(batchSize) || 0));
  const prepared = [];
  const seenLinks = new Set();
  let prefilteredCount = 0;

  for (const candidate of candidates) {
    const originalLink = normalizedOriginalLink(candidate);
    if (!originalLink || seenLinks.has(originalLink)) {
      prefilteredCount += 1;
      continue;
    }

    seenLinks.add(originalLink);
    prepared.push({ ...candidate, originalLink });
  }

  const selected = [];
  let selectedChars = 0;
  let extractedCount = 0;

  for (
    let offset = 0;
    offset < prepared.length && selected.length < safeLimit;
    offset += safeBatchSize
  ) {
    const batch = prepared.slice(offset, offset + safeBatchSize);
    const settled = await Promise.all(
      batch.map(async (article) => {
        try {
          const extracted = await extractor(article.originalLink);
          return { ok: true, article, extracted };
        } catch {
          return { ok: false, article, extracted: null };
        }
      })
    );
    extractedCount += settled.length;

    for (const result of settled) {
      if (!result.ok || selected.length >= safeLimit) continue;

      const textLength = String(result.extracted?.text ?? "").length;
      if (
        textLength === 0 ||
        selectedChars + textLength > maxTotalChars
      ) {
        continue;
      }

      selectedChars += textLength;
      selected.push({
        ...result.article,
        id: String(selected.length + 1),
        fullTextAvailable: true,
      });
    }
  }

  const checkedCount = prefilteredCount + extractedCount;
  return {
    articles: selected,
    checkedCount,
    excludedCount: Math.max(0, checkedCount - selected.length),
    complete: selected.length === safeLimit,
  };
}
