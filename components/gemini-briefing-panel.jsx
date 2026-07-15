import dynamic from "next/dynamic";

import GeminiInfographic from "@/components/gemini-infographic";

const MessageResponse = dynamic(
  () =>
    import("@/components/ai-elements/message").then(
      (module) => module.MessageResponse
    ),
  {
    ssr: false,
    loading: () => <p>Gemini 브리핑 화면을 준비하고 있습니다…</p>,
  }
);

const STATUS_LABELS = {
  streaming: "자동 생성 중",
  done: "자동 생성 완료",
  error: "자동 생성 실패",
  skipped: "자동 생성 생략",
};

export default function GeminiBriefingPanel({
  items,
  status = "idle",
  briefingText = "",
  infographic = null,
  failure = null,
}) {
  const hasThreeArticles = items.length === 3;
  const hasStarted =
    hasThreeArticles &&
    (status === "streaming" ||
      status === "done" ||
      status === "error" ||
      Boolean(briefingText));

  return (
    <section
      className="gemini-briefing-panel"
      aria-labelledby="gemini-briefing-title"
    >
      <div className="gemini-briefing-heading">
        <div>
          <span className="gemini-eyebrow">DIRECT GEMINI API</span>
          <h2 id="gemini-briefing-title">Gemini 무료 API 브리핑</h2>
          <p>
            검색에서 확보한 세 기사 전문을 다시 조회하지 않고 곧바로
            비교·요약합니다.
          </p>
        </div>
        <span
          className={`gemini-auto-status gemini-auto-status-${status}`}
          role="status"
        >
          {STATUS_LABELS[status] || "자동 생성 대기"}
        </span>
      </div>

      <div className="gemini-data-notice">
        <strong>무료 API 데이터 안내</strong>
        <p>
          기사 전문과 생성 결과는 Google 제품 개선에 사용되거나 사람이 검토할
          수 있습니다. 민감정보가 포함된 검색에는 사용하지 마세요. {" "}
          <a
            href="https://ai.google.dev/gemini-api/terms"
            target="_blank"
            rel="noopener noreferrer"
          >
            데이터 이용 조건
          </a>
          {" · "}
          <a
            href="https://ai.google.dev/gemini-api/docs/rate-limits"
            target="_blank"
            rel="noopener noreferrer"
          >
            무료 한도 확인
          </a>
        </p>
      </div>

      {!hasThreeArticles && (
        <p className="gemini-briefing-notice" role="status">
          검색 시점에 전문 확보를 통과한 기사 3건이 필요합니다. 이번 검색에서는
          Gemini 자동 브리핑을 생성하지 않았습니다.
        </p>
      )}

      {status === "streaming" && (
        <div
          className="gemini-briefing-progress"
          role="status"
          aria-live="polite"
        >
          <span className="gemini-progress-dot" />
          검색에서 확보한 전문을 그대로 사용해 Gemini가 종합 브리핑을 작성하고
          있습니다.
        </div>
      )}

      {failure && !briefingText && (
        <div className="gemini-briefing-error" role="alert">
          <strong>Gemini 브리핑을 만들지 못했습니다.</strong>
          <p>{failure.message}</p>
          {failure.actionUrl && (
            <a
              className="gemini-error-action"
              href={failure.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {failure.actionLabel || "Gemini 설정 확인"}
            </a>
          )}
          <dl className="gemini-error-meta">
            <div>
              <dt>오류 코드</dt>
              <dd>{failure.code}</dd>
            </div>
            {failure.providerCode && failure.providerCode !== failure.code && (
              <div>
                <dt>제공사 코드</dt>
                <dd>{failure.providerCode}</dd>
              </div>
            )}
            {failure.status && (
              <div>
                <dt>HTTP 상태</dt>
                <dd>
                  {failure.status}
                  {failure.statusText ? ` ${failure.statusText}` : ""}
                </dd>
              </div>
            )}
            {failure.requestId && (
              <div>
                <dt>요청 ID</dt>
                <dd>{failure.requestId}</dd>
              </div>
            )}
            {failure.responseType && (
              <div>
                <dt>응답 형식</dt>
                <dd>{failure.responseType}</dd>
              </div>
            )}
          </dl>
          {Array.isArray(failure.articles) && (
            <ul>
              {failure.articles.map((article) => {
                const item = items.find(
                  (candidate) => candidate.id === article.id
                );
                return (
                  <li key={article.id}>
                    <span
                      className={article.status === "ready" ? "ready" : "failed"}
                    >
                      [{article.id}]{" "}
                      {article.status === "ready" ? "전문 확보" : "확보 실패"}
                    </span>
                    {item?.title ? ` ${item.title}` : ""}
                    {article.reason ? ` — ${article.reason}` : ""}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {briefingText && (
        <article className="gemini-briefing-output" aria-live="polite">
          <MessageResponse isAnimating={status === "streaming"}>
            {briefingText}
          </MessageResponse>
        </article>
      )}

      {infographic && <GeminiInfographic infographic={infographic} />}

      {hasStarted && (
        <div className="gemini-briefing-sources">
          <h3>검토한 원문</h3>
          <ol>
            {items.map((item) => (
              <li key={item.id}>
                <span>[{item.id}]</span>
                <a
                  href={item.originalLink || item.naverLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
