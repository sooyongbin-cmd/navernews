import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import {
  geminiFailureFromResponse,
  geminiNetworkFailure,
  geminiStreamFailure,
} from "@/lib/gemini-client-error.mjs";
import {
  consumeGeminiSse,
  GeminiSseError,
} from "@/lib/gemini-sse-client.mjs";

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

function responseMetadata(response) {
  return {
    status: response.status,
    statusText: response.statusText || null,
    requestId:
      response.headers.get("x-briefing-request-id") ||
      response.headers.get("x-vercel-id") ||
      response.headers.get("x-request-id") ||
      null,
    responseType:
      response.headers.get("content-type")?.split(";", 1)[0] || null,
  };
}

export default function GeminiBriefingPanel({
  briefingToken,
  expiresAt,
  items,
}) {
  const [status, setStatus] = useState("idle");
  const [briefingText, setBriefingText] = useState("");
  const [failure, setFailure] = useState(null);
  const [hasAttempted, setHasAttempted] = useState(false);
  const controllerRef = useRef(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    []
  );

  const isBusy = status === "submitted" || status === "streaming";

  async function requestBriefing() {
    if (!briefingToken || isBusy) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setFailure(null);
    setBriefingText("");
    setHasAttempted(true);
    setStatus("submitted");

    let metadata = {};

    try {
      const response = await fetch("/api/gemini-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefingToken }),
        signal: controller.signal,
      });
      metadata = responseMetadata(response);

      if (!response.ok) {
        setFailure(await geminiFailureFromResponse(response));
        setStatus("error");
        return;
      }

      if (metadata.responseType !== "text/event-stream") {
        throw new GeminiSseError({
          code: "GEMINI_STREAM_PROTOCOL_ERROR",
          message: "Gemini 브리핑 서버가 스트리밍 응답을 반환하지 않았습니다.",
          status: response.status,
          requestId: metadata.requestId,
        });
      }

      setStatus("streaming");
      await consumeGeminiSse(response, {
        onDelta(text) {
          setBriefingText((current) => current + text);
        },
      });
      setStatus("done");
    } catch (error) {
      setBriefingText("");
      setFailure(
        error instanceof GeminiSseError
          ? geminiStreamFailure(error, metadata)
          : geminiNetworkFailure(error)
      );
      setStatus("error");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }

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
            Vercel AI Gateway 없이 Google Gemini API가 세 기사 전문을 직접
            비교·요약합니다.
          </p>
        </div>
        <button
          type="button"
          className="gemini-briefing-button"
          onClick={requestBriefing}
          disabled={!briefingToken || isBusy}
        >
          {status === "submitted"
            ? "전문 확인 중…"
            : status === "streaming"
              ? "Gemini 종합 중…"
              : briefingText
                ? "Gemini 브리핑 다시 생성"
                : "Gemini로 AI 검색 브리핑 생성"}
        </button>
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

      {!briefingToken && (
        <p className="gemini-briefing-notice" role="status">
          원문 링크가 있는 기사 3건이 모두 검색되어야 Gemini 브리핑을 만들 수
          있습니다.
        </p>
      )}

      {briefingToken && !hasAttempted && (
        <p className="gemini-briefing-notice" role="status">
          브리핑 요청은 검색 후 5분 동안 유효합니다
          {expiresAt
            ? ` · 만료 ${new Date(expiresAt).toLocaleTimeString("ko-KR")}`
            : ""}
          .
        </p>
      )}

      {isBusy && (
        <div
          className="gemini-briefing-progress"
          role="status"
          aria-live="polite"
        >
          <span className="gemini-progress-dot" />
          {status === "submitted"
            ? "언론사 정책과 세 기사 전문을 확인하고 있습니다."
            : "Gemini가 세 기사 전체를 비교해 종합 브리핑을 작성하고 있습니다."}
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
        <article className="gemini-briefing-output" aria-live="polite">
          <MessageResponse isAnimating={status === "streaming"}>
            {briefingText}
          </MessageResponse>
        </article>
      )}

      {(briefingText || hasAttempted) && (
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
