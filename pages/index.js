import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import dynamic from "next/dynamic";
import Head from "next/head";
import { useMemo, useState } from "react";

import {
  briefingFailureFromResponse,
  briefingNetworkFailure,
  briefingStreamFailure,
} from "@/lib/briefing-client-error.mjs";

const MessageResponse = dynamic(
  () =>
    import("@/components/ai-elements/message").then(
      (module) => module.MessageResponse
    ),
  {
    ssr: false,
    loading: () => <p>브리핑 화면을 준비하고 있습니다…</p>,
  }
);

function formatPubDate(pubDate) {
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return pubDate;

  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function sourceOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "출처 미상";
  }
}

function latestAssistantText(messages) {
  const assistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  return (assistant?.parts || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function BriefingPanel({ briefingToken, expiresAt, items, searchedFor }) {
  const [failure, setFailure] = useState(null);
  const [streamFailure, setStreamFailure] = useState(null);
  const [responseMeta, setResponseMeta] = useState({});
  const [hasAttempted, setHasAttempted] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/briefing",
        prepareSendMessagesRequest: () => ({
          body: { briefingToken },
        }),
        fetch: async (input, init) => {
          try {
            const response = await fetch(input, init);
            const metadata = {
              status: response.status,
              statusText: response.statusText || null,
              requestId:
                response.headers.get("x-briefing-request-id") ||
                response.headers.get("x-vercel-id") ||
                response.headers.get("x-request-id") ||
                null,
              responseType:
                response.headers.get("content-type")?.split(";", 1)[0] ||
                null,
            };
            setResponseMeta(metadata);

            if (!response.ok) {
              setFailure(await briefingFailureFromResponse(response));
            }

            return response;
          } catch (fetchError) {
            setFailure(briefingNetworkFailure(fetchError));
            throw fetchError;
          }
        },
      }),
    [briefingToken]
  );

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onError(chatError) {
      setStreamFailure(briefingStreamFailure(chatError, responseMeta));
    },
  });

  const briefingText = latestAssistantText(messages);
  const isBusy = status === "submitted" || status === "streaming";

  async function requestBriefing() {
    if (!briefingToken || isBusy) return;

    setFailure(null);
    setStreamFailure(null);
    setResponseMeta({});
    setMessages([]);
    setHasAttempted(true);

    try {
      await sendMessage({
        text: `검색어 '${searchedFor}'의 기사 3건을 종합해 주세요.`,
      });
    } catch {
      // useChat의 onError와 커스텀 transport가 사용자용 오류를 설정합니다.
    }
  }

  const displayedFailure =
    failure ||
    streamFailure ||
    (error ? briefingStreamFailure(error, responseMeta) : null);

  return (
    <section className="briefing-panel" aria-labelledby="briefing-title">
      <div className="briefing-heading">
        <div>
          <span className="eyebrow">AI SEARCH BRIEFING</span>
          <h2 id="briefing-title">기사 3건 전문 종합</h2>
          <p>
            세 원문이 모두 확보된 경우에만 AI가 한 번에 비교·요약합니다.
          </p>
        </div>
        <button
          type="button"
          className="briefing-button"
          onClick={requestBriefing}
          disabled={!briefingToken || isBusy}
        >
          {status === "submitted"
            ? "전문 확인 중…"
            : status === "streaming"
              ? "AI 종합 중…"
              : briefingText
                ? "브리핑 다시 생성"
                : "AI 검색 브리핑 생성"}
        </button>
      </div>

      {!briefingToken && (
        <p className="briefing-notice" role="status">
          원문 링크가 있는 기사 3건이 모두 검색되어야 브리핑을 만들 수 있습니다.
        </p>
      )}

      {briefingToken && !hasAttempted && (
        <p className="briefing-notice" role="status">
          브리핑 요청은 검색 후 5분 동안 유효합니다
          {expiresAt ? ` · 만료 ${new Date(expiresAt).toLocaleTimeString("ko-KR")}` : ""}.
        </p>
      )}

      {isBusy && (
        <div className="briefing-progress" role="status" aria-live="polite">
          <span className="progress-dot" />
          {status === "submitted"
            ? "언론사 정책과 세 기사 전문을 확인하고 있습니다."
            : "세 기사 전체를 비교해 종합 브리핑을 작성하고 있습니다."}
        </div>
      )}

      {displayedFailure && !briefingText && (
        <div className="briefing-error" role="alert">
          <strong>브리핑을 만들지 못했습니다.</strong>
          <p>{displayedFailure.message}</p>
          {displayedFailure.actionUrl && (
            <a
              className="briefing-error-action"
              href={displayedFailure.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel에서 카드 등록 및 무료 크레딧 확인
            </a>
          )}
          <dl className="briefing-error-meta">
            <div>
              <dt>오류 코드</dt>
              <dd>{displayedFailure.code}</dd>
            </div>
            {displayedFailure.status && (
              <div>
                <dt>HTTP 상태</dt>
                <dd>
                  {displayedFailure.status}
                  {displayedFailure.statusText
                    ? ` ${displayedFailure.statusText}`
                    : ""}
                </dd>
              </div>
            )}
            {displayedFailure.requestId && (
              <div>
                <dt>요청 ID</dt>
                <dd>{displayedFailure.requestId}</dd>
              </div>
            )}
            {displayedFailure.responseType &&
              displayedFailure.responseType !== "application/json" && (
                <div>
                  <dt>응답 형식</dt>
                  <dd>{displayedFailure.responseType}</dd>
                </div>
              )}
          </dl>
          {Array.isArray(failure?.articles) && (
            <ul>
              {failure.articles.map((article) => {
                const item = items.find((candidate) => candidate.id === article.id);
                return (
                  <li key={article.id}>
                    <span className={article.status === "ready" ? "ready" : "failed"}>
                      [{article.id}] {article.status === "ready" ? "전문 확보" : "확보 실패"}
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
        <article className="briefing-output" aria-live="polite">
          <MessageResponse isAnimating={status === "streaming"}>
            {briefingText}
          </MessageResponse>
        </article>
      )}

      {(briefingText || hasAttempted) && (
        <div className="briefing-sources">
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchedFor, setSearchedFor] = useState("");
  const [briefingToken, setBriefingToken] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);

  const todayLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  async function handleSearch(event) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;

    setStatus("loading");
    setErrorMessage("");
    setItems([]);
    setBriefingToken(null);
    setExpiresAt(null);

    try {
      const response = await fetch(
        `/api/search?query=${encodeURIComponent(normalizedQuery)}`
      );
      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data.message || "뉴스 검색 중 오류가 발생했습니다.");
        return;
      }

      setItems(data.items || []);
      setSearchedFor(data.query || normalizedQuery);
      setBriefingToken(data.briefingToken || null);
      setExpiresAt(data.expiresAt || null);
      setStatus("done");
    } catch {
      setStatus("error");
      setErrorMessage("네트워크 오류로 검색하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  return (
    <>
      <Head>
        <title>뉴스와이어 — 네이버 뉴스 검색과 AI 브리핑</title>
        <meta
          name="description"
          content="네이버 최신 뉴스 3건을 검색하고 기사 전문을 바탕으로 AI 종합 브리핑을 생성합니다."
        />
      </Head>

      <div className="page">
        <header className="masthead">
          <div className="masthead-rule" />
          <h1>뉴스와이어</h1>
          <p className="dateline" suppressHydrationWarning>
            {todayLabel} · 네이버 뉴스 최신 검색 결과 3건
          </p>
          <div className="masthead-rule" />
        </header>

        <form className="search-bar" onSubmit={handleSearch}>
          <label htmlFor="query">QUERY</label>
          <input
            id="query"
            type="search"
            maxLength={100}
            placeholder="검색할 키워드를 입력하세요"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "검색 중…" : "검색"}
          </button>
        </form>

        <section className="results" aria-live="polite">
          {status === "idle" && (
            <p className="hint">
              키워드를 입력하면 발행 시각 기준 최신 뉴스 3건을 보여드립니다.
              브리핑은 버튼을 눌렀을 때만 생성됩니다.
            </p>
          )}

          {status === "error" && <p className="error">{errorMessage}</p>}

          {status === "done" && items.length === 0 && (
            <p className="hint">
              &lsquo;{searchedFor}&rsquo;에 대한 검색 결과가 없습니다. 다른 키워드로
              다시 검색해 보세요.
            </p>
          )}

          {status === "done" && items.length > 0 && (
            <>
              <ol className="news-list">
                {items.map((item) => {
                  const articleLink = item.originalLink || item.naverLink;
                  return (
                    <li key={item.id} className="news-item">
                      <span className="index">{String(item.id).padStart(2, "0")}</span>
                      <div className="news-body">
                        <div className="news-meta">
                          <span className="source">{sourceOf(articleLink)}</span>
                          <span className="dot">·</span>
                          <span className="time">{formatPubDate(item.pubDate)}</span>
                        </div>
                        <a
                          className="news-title"
                          href={articleLink}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title}
                        </a>
                        <p className="news-desc">{item.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <BriefingPanel
                key={briefingToken || `unavailable-${searchedFor}`}
                briefingToken={briefingToken}
                expiresAt={expiresAt}
                items={items}
                searchedFor={searchedFor}
              />
            </>
          )}
        </section>

        <footer className="footer">
          <span>Powered by Naver Search API · Vercel AI Gateway</span>
        </footer>
      </div>

      <style jsx global>{`
        .page {
          max-width: 800px;
          margin: 0 auto;
          padding: 56px 24px 80px;
          min-height: 100vh;
        }

        .masthead {
          text-align: center;
          margin-bottom: 40px;
        }

        .masthead-rule {
          height: 2px;
          background: var(--ink);
        }

        .masthead h1 {
          font-family: var(--font-display);
          font-weight: 900;
          font-size: clamp(2.4rem, 6vw, 3.4rem);
          letter-spacing: 0.02em;
          margin: 10px 0 4px;
        }

        .dateline {
          font-family: var(--font-mono);
          font-size: 0.78rem;
          color: var(--ink-dim);
          letter-spacing: 0.04em;
          margin: 0 0 10px;
        }

        .search-bar {
          display: flex;
          align-items: stretch;
          border: 2px solid var(--ink);
          background: #fff;
          margin-bottom: 36px;
        }

        .search-bar label {
          display: flex;
          align-items: center;
          padding: 0 14px;
          font-family: var(--font-mono);
          font-size: 0.72rem;
          letter-spacing: 0.1em;
          color: var(--ink-dim);
          border-right: 1px solid var(--rule);
          background: var(--paper-dim);
        }

        .search-bar input {
          flex: 1;
          min-width: 0;
          border: none;
          padding: 16px 14px;
          font-size: 1rem;
          font-family: var(--font-body);
          background: transparent;
          color: var(--ink);
        }

        .search-bar input:focus {
          outline: none;
        }

        .search-bar button,
        .briefing-button {
          border: none;
          background: var(--wire-red);
          color: #fff;
          font-family: var(--font-body);
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .search-bar button {
          border-left: 2px solid var(--ink);
          padding: 0 26px;
        }

        .search-bar button:hover:not(:disabled),
        .briefing-button:hover:not(:disabled) {
          background: #8f1b16;
        }

        .search-bar button:disabled,
        .briefing-button:disabled {
          background: var(--ink-dim);
          cursor: default;
          opacity: 0.75;
        }

        .hint,
        .error {
          font-family: var(--font-body);
          line-height: 1.6;
          padding: 24px 0;
          border-top: 1px solid var(--rule);
        }

        .hint {
          color: var(--ink-dim);
        }

        .error {
          color: var(--wire-red);
          font-weight: 600;
        }

        .news-list {
          list-style: none;
          margin: 0;
          padding: 0;
          border-top: 1px solid var(--rule);
        }

        .news-item {
          display: flex;
          gap: 18px;
          padding: 22px 0;
          border-bottom: 1px solid var(--rule);
        }

        .index {
          font-family: var(--font-mono);
          font-size: 0.85rem;
          color: var(--wire-navy);
          padding-top: 3px;
          flex-shrink: 0;
          width: 24px;
        }

        .news-body {
          flex: 1;
          min-width: 0;
        }

        .news-meta {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--ink-dim);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        .dot {
          margin: 0 6px;
        }

        .news-title {
          display: block;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.15rem;
          line-height: 1.4;
          color: var(--ink);
          text-decoration: none;
          margin-bottom: 6px;
        }

        .news-title:hover {
          color: var(--wire-red);
          text-decoration: underline;
        }

        .news-desc {
          font-family: var(--font-body);
          font-size: 0.92rem;
          line-height: 1.6;
          color: var(--ink-dim);
          margin: 0;
        }

        .briefing-panel {
          margin-top: 38px;
          border: 2px solid var(--ink);
          background: #fff;
        }

        .briefing-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          padding: 24px;
          background: var(--paper-dim);
          border-bottom: 1px solid var(--ink);
        }

        .eyebrow {
          display: block;
          font-family: var(--font-mono);
          color: var(--wire-red);
          font-size: 0.68rem;
          letter-spacing: 0.12em;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .briefing-heading h2 {
          font-family: var(--font-display);
          font-size: 1.45rem;
          margin: 0 0 6px;
        }

        .briefing-heading p,
        .briefing-notice {
          color: var(--ink-dim);
          font-size: 0.86rem;
          line-height: 1.5;
          margin: 0;
        }

        .briefing-button {
          appearance: none;
          flex: 0 0 auto;
          min-width: 174px;
          min-height: 48px;
          padding: 12px 18px;
          border: 2px solid var(--ink);
          border-radius: 2px;
          box-shadow: 3px 3px 0 var(--ink);
          font-size: 0.92rem;
          line-height: 1.2;
          letter-spacing: 0.01em;
          transform: translate(0, 0);
          transition:
            background 0.15s ease,
            box-shadow 0.15s ease,
            transform 0.15s ease;
        }

        .briefing-button:hover:not(:disabled) {
          box-shadow: 4px 4px 0 var(--ink);
          transform: translate(-1px, -1px);
        }

        .briefing-button:active:not(:disabled) {
          box-shadow: 1px 1px 0 var(--ink);
          transform: translate(2px, 2px);
        }

        .briefing-button:disabled {
          border-color: var(--ink-dim);
          box-shadow: 2px 2px 0 var(--ink-dim);
        }

        .briefing-notice,
        .briefing-progress,
        .briefing-error,
        .briefing-output,
        .briefing-sources {
          padding: 20px 24px;
        }

        .briefing-progress {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--wire-navy);
          font-weight: 600;
        }

        .progress-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--wire-red);
          animation: pulse 1.2s ease-in-out infinite;
        }

        .briefing-error {
          color: var(--wire-red);
          background: #fff7f5;
          border: 2px solid var(--wire-red);
          box-shadow: 3px 3px 0 color-mix(in srgb, var(--wire-red) 28%, transparent);
          margin: 20px 24px;
          padding: 18px 20px;
        }

        .briefing-error > strong {
          display: block;
          font-family: var(--font-display);
          font-size: 1.08rem;
        }

        .briefing-error p {
          margin: 6px 0 0;
        }

        .briefing-error-action {
          display: inline-block;
          margin-top: 14px;
          padding: 9px 12px;
          border: 1px solid currentColor;
          background: #fff;
          color: var(--wire-red);
          font-size: 0.82rem;
          font-weight: 700;
          text-decoration: none;
        }

        .briefing-error-action:hover {
          background: var(--wire-red);
          color: #fff;
        }

        .briefing-error ul {
          color: var(--ink-dim);
          margin: 14px 0 0;
          padding-left: 20px;
        }

        .briefing-error li + li {
          margin-top: 8px;
        }

        .briefing-error-meta {
          display: grid;
          gap: 7px;
          margin: 16px 0 0;
          padding-top: 14px;
          border-top: 1px solid color-mix(in srgb, var(--wire-red) 35%, white);
          color: var(--ink-dim);
          font-size: 0.78rem;
        }

        .briefing-error-meta div {
          display: grid;
          grid-template-columns: 82px minmax(0, 1fr);
          gap: 10px;
        }

        .briefing-error-meta dt {
          font-weight: 700;
          color: var(--wire-red);
        }

        .briefing-error-meta dd {
          min-width: 0;
          margin: 0;
          font-family: var(--font-mono);
          overflow-wrap: anywhere;
        }

        .briefing-error .ready {
          color: #2f6c43;
          font-weight: 700;
        }

        .briefing-error .failed {
          color: var(--wire-red);
          font-weight: 700;
        }

        .briefing-output {
          font-family: var(--font-body);
          line-height: 1.75;
          overflow-wrap: anywhere;
        }

        .briefing-output h2 {
          font-family: var(--font-display);
          font-size: 1.3rem;
          margin-top: 1.8rem;
          padding-bottom: 0.35rem;
          border-bottom: 1px solid var(--rule);
        }

        .briefing-output h2:first-child {
          margin-top: 0;
        }

        .briefing-output :global(ul) {
          padding-left: 1.25rem;
        }

        .briefing-sources {
          border-top: 1px solid var(--rule);
          background: #faf9f5;
        }

        .briefing-sources h3 {
          font-family: var(--font-mono);
          font-size: 0.76rem;
          letter-spacing: 0.08em;
          margin: 0 0 12px;
        }

        .briefing-sources ol {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .briefing-sources li {
          display: flex;
          gap: 9px;
          line-height: 1.45;
          font-size: 0.86rem;
        }

        .briefing-sources li + li {
          margin-top: 8px;
        }

        .briefing-sources span {
          font-family: var(--font-mono);
          color: var(--wire-red);
        }

        .briefing-sources a:hover {
          color: var(--wire-red);
          text-decoration: underline;
        }

        .footer {
          margin-top: 48px;
          text-align: center;
          font-family: var(--font-mono);
          font-size: 0.7rem;
          color: var(--ink-dim);
          letter-spacing: 0.08em;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 0.35;
            transform: scale(0.85);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @media (max-width: 640px) {
          .briefing-heading {
            flex-direction: column;
          }

          .briefing-button {
            width: 100%;
          }
        }

        @media (max-width: 480px) {
          .page {
            padding-left: 16px;
            padding-right: 16px;
          }

          .search-bar {
            flex-wrap: wrap;
          }

          .search-bar label {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid var(--rule);
            padding: 10px 14px;
          }

          .search-bar button {
            border-left: none;
            border-top: 2px solid var(--ink);
            width: 100%;
            padding: 14px;
          }

          .briefing-heading,
          .briefing-notice,
          .briefing-progress,
          .briefing-output,
          .briefing-sources {
            padding-left: 17px;
            padding-right: 17px;
          }

          .briefing-error {
            margin: 16px;
            padding: 16px;
          }
        }
      `}</style>
    </>
  );
}
