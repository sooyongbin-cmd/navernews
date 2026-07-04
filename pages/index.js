import Head from "next/head";
import { useState } from "react";

function formatPubDate(pubDate) {
  try {
    const d = new Date(pubDate);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return pubDate;
  }
}

function sourceOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const [searchedFor, setSearchedFor] = useState("");

  const todayLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  async function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(q)}`);
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.message || "검색 중 오류가 발생했습니다.");
        return;
      }

      setItems(data.items || []);
      setSearchedFor(q);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg("네트워크 오류로 검색하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  return (
    <>
      <Head>
        <title>뉴스와이어 — 네이버 뉴스 검색</title>
        <meta
          name="description"
          content="키워드로 네이버 뉴스 최신순 검색 결과 10건을 확인하세요."
        />
      </Head>

      <div className="page">
        <header className="masthead">
          <div className="masthead-rule" />
          <h1>뉴스와이어</h1>
          <p className="dateline">
            {todayLabel} · 네이버 뉴스 검색 결과 최신순 10건
          </p>
          <div className="masthead-rule" />
        </header>

        <form className="search-bar" onSubmit={handleSearch}>
          <label htmlFor="query">QUERY</label>
          <input
            id="query"
            type="text"
            placeholder="검색할 키워드를 입력하세요 (예: 인공지능)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "검색 중…" : "검색"}
          </button>
        </form>

        <section className="results">
          {status === "idle" && (
            <p className="hint">
              키워드를 입력하고 검색을 누르면 최신 뉴스 10건이 발행 시각 순으로
              나열됩니다.
            </p>
          )}

          {status === "error" && <p className="error">{errorMsg}</p>}

          {status === "done" && items.length === 0 && (
            <p className="hint">
              &lsquo;{searchedFor}&rsquo;에 대한 검색 결과가 없습니다. 다른
              키워드로 다시 검색해 보세요.
            </p>
          )}

          {status === "done" && items.length > 0 && (
            <ol className="news-list">
              {items.map((item, idx) => (
                <li key={item.link + idx} className="news-item">
                  <span className="index">{String(idx + 1).padStart(2, "0")}</span>
                  <div className="news-body">
                    <div className="news-meta">
                      <span className="source">{sourceOf(item.link)}</span>
                      <span className="dot">·</span>
                      <span className="time">{formatPubDate(item.pubDate)}</span>
                    </div>
                    <a
                      className="news-title"
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.title}
                    </a>
                    <p className="news-desc">{item.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="footer">
          <span>Powered by Naver Search API (News)</span>
        </footer>
      </div>

      <style jsx>{`
        .page {
          max-width: 760px;
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
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin: 0 0 10px;
        }

        .search-bar {
          display: flex;
          align-items: stretch;
          gap: 0;
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

        .search-bar button {
          border: none;
          border-left: 2px solid var(--ink);
          background: var(--wire-red);
          color: #fff;
          font-family: var(--font-body);
          font-weight: 600;
          padding: 0 26px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .search-bar button:hover:not(:disabled) {
          background: #8f1b16;
        }

        .search-bar button:disabled {
          background: var(--ink-dim);
          cursor: default;
        }

        .hint {
          font-family: var(--font-body);
          color: var(--ink-dim);
          line-height: 1.6;
          padding: 24px 0;
          border-top: 1px solid var(--rule);
        }

        .error {
          font-family: var(--font-body);
          color: var(--wire-red);
          font-weight: 600;
          padding: 24px 0;
          border-top: 1px solid var(--rule);
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

        .footer {
          margin-top: 48px;
          text-align: center;
          font-family: var(--font-mono);
          font-size: 0.7rem;
          color: var(--ink-dim);
          letter-spacing: 0.08em;
        }

        @media (max-width: 480px) {
          .search-bar {
            flex-wrap: wrap;
          }
          .search-bar label {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid var(--rule);
          }
          .search-bar button {
            border-left: none;
            border-top: 2px solid var(--ink);
            width: 100%;
            padding: 14px;
          }
        }
      `}</style>
    </>
  );
}
