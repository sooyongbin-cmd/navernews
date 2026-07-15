const STATUS_MESSAGES = {
  400: "Gemini 브리핑 요청 정보가 올바르지 않거나 만료되었습니다. 뉴스를 다시 검색해 주세요.",
  401: "Gemini API 인증에 실패했습니다. 서버 환경 변수를 확인해 주세요.",
  403: "Gemini API 키 또는 프로젝트 권한이 요청을 허용하지 않습니다.",
  404: "Gemini 브리핑 API 경로를 찾지 못했습니다. 최신 배포 상태를 확인해 주세요.",
  422: "세 기사 중 하나 이상의 전문을 안전하게 확보하지 못했습니다.",
  429: "Gemini 무료 API 호출 한도를 모두 사용했습니다.",
  500: "Gemini 브리핑 서버 함수 내부에서 오류가 발생했습니다.",
  502: "Gemini API에서 정상 응답을 받지 못했습니다.",
  503: "Gemini 브리핑 서버를 일시적으로 사용할 수 없습니다.",
  504: "기사 확인 또는 Gemini 응답 시간이 서버 제한을 초과했습니다.",
};

function responseRequestId(response) {
  return (
    response.headers.get("x-briefing-request-id") ||
    response.headers.get("x-vercel-id") ||
    response.headers.get("x-request-id") ||
    null
  );
}

function responseType(response) {
  return response.headers.get("content-type")?.split(";", 1)[0] || null;
}

function parseJsonObject(value) {
  if (typeof value !== "string" || !value.trim().startsWith("{")) return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function actionForCode(code) {
  if (
    code === "GEMINI_AUTH_ERROR" ||
    code === "GEMINI_CONFIGURATION_ERROR"
  ) {
    return {
      actionUrl: "https://aistudio.google.com/app/apikey",
      actionLabel: "Google AI Studio에서 API 키 확인",
    };
  }

  if (code === "GEMINI_FREE_QUOTA_EXHAUSTED") {
    return {
      actionUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
      actionLabel: "Gemini 무료 한도와 갱신 기준 확인",
    };
  }

  return {};
}

function infrastructureMessage(status, body) {
  const normalizedBody = body.toUpperCase();

  if (normalizedBody.includes("FUNCTION_INVOCATION_TIMEOUT")) {
    return "Vercel 함수 실행 시간이 초과되었습니다. 기사 원문 또는 Gemini 응답이 제한 시간 안에 끝나지 않았습니다.";
  }

  if (normalizedBody.includes("FUNCTION_INVOCATION_FAILED")) {
    return "Gemini 브리핑 함수가 예외로 종료되었습니다. 요청 ID로 Vercel 함수 로그를 확인해 주세요.";
  }

  return (
    STATUS_MESSAGES[status] ||
    `Gemini 브리핑 API가 HTTP ${status} 오류를 반환했습니다.`
  );
}

export async function geminiFailureFromResponse(response) {
  const requestId = responseRequestId(response);
  const contentType = responseType(response);
  const body = await response.clone().text().catch(() => "");
  const json = parseJsonObject(body);

  if (json) {
    const code = json.code || `GEMINI_HTTP_${response.status}`;
    return {
      ...json,
      ...actionForCode(code),
      code,
      message: json.message || infrastructureMessage(response.status, body),
      status: response.status,
      statusText: response.statusText || null,
      requestId: json.requestId || requestId,
      responseType: contentType,
    };
  }

  return {
    code: `GEMINI_HTTP_${response.status}`,
    message: infrastructureMessage(response.status, body),
    status: response.status,
    statusText: response.statusText || null,
    requestId,
    responseType: contentType,
  };
}

export function geminiNetworkFailure(error) {
  const aborted = error?.name === "AbortError";
  return {
    code: aborted ? "GEMINI_REQUEST_ABORTED" : "GEMINI_NETWORK_ERROR",
    message: aborted
      ? "Gemini 브리핑 요청이 완료되기 전에 취소되었습니다."
      : "Gemini 브리핑 API에 연결하지 못했습니다. 네트워크 연결과 배포 상태를 확인해 주세요.",
    status: null,
    statusText: null,
    requestId: null,
    responseType: null,
  };
}

export function geminiStreamFailure(error, responseMeta = {}) {
  const details = error?.details || {};
  const code = details.code || "GEMINI_STREAM_ERROR";

  return {
    ...details,
    ...actionForCode(code),
    code,
    message:
      details.message ||
      error?.message ||
      "Gemini 브리핑 스트림을 처리하는 중 오류가 발생했습니다.",
    status: details.status ?? responseMeta.status ?? null,
    statusText: responseMeta.statusText ?? null,
    requestId: details.requestId || responseMeta.requestId || null,
    responseType: responseMeta.responseType || null,
  };
}
