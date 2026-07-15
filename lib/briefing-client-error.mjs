const STATUS_MESSAGES = {
  400: "브리핑 요청 정보가 올바르지 않거나 만료되었습니다. 뉴스를 다시 검색해 주세요.",
  401: "브리핑 API 또는 AI Gateway 인증에 실패했습니다. 서버 환경 변수를 확인해 주세요.",
  403: "브리핑 요청이 서버 또는 원문 사이트의 접근 정책에 의해 거부되었습니다.",
  404: "브리핑 API 경로를 찾지 못했습니다. 최신 배포에 /api/briefing이 포함됐는지 확인해 주세요.",
  405: "브리핑 API가 현재 요청 방식을 허용하지 않습니다.",
  413: "브리핑 요청 데이터가 서버 허용 크기를 초과했습니다.",
  422: "세 기사 중 하나 이상의 전문을 안전하게 확보하지 못했습니다.",
  429: "AI Gateway 무료 크레딧 또는 호출 한도를 모두 사용했습니다.",
  500: "브리핑 서버 함수 내부에서 오류가 발생했습니다. 요청 ID로 서버 로그를 확인해 주세요.",
  502: "브리핑 서버가 AI Gateway 또는 외부 서비스에서 정상 응답을 받지 못했습니다.",
  503: "브리핑 서버를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  504: "기사 확인 또는 AI 응답 시간이 서버 제한을 초과했습니다.",
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

function infrastructureMessage(status, body) {
  const normalizedBody = body.toUpperCase();

  if (normalizedBody.includes("FUNCTION_INVOCATION_TIMEOUT")) {
    return "Vercel 함수 실행 시간이 초과되었습니다. 기사 원문 응답 또는 AI Gateway 응답이 제한 시간 안에 끝나지 않았습니다.";
  }

  if (normalizedBody.includes("FUNCTION_INVOCATION_FAILED")) {
    return "Vercel 브리핑 함수 실행이 예외로 종료되었습니다. 요청 ID로 함수 로그를 확인해 주세요.";
  }

  if (normalizedBody.includes("DEPLOYMENT_NOT_FOUND")) {
    return "요청한 Vercel 배포를 찾지 못했습니다. 배포 URL과 프로젝트 연결 상태를 확인해 주세요.";
  }

  return (
    STATUS_MESSAGES[status] ||
    `브리핑 API가 HTTP ${status} 오류를 반환했습니다. 요청 ID로 서버 로그를 확인해 주세요.`
  );
}

export async function briefingFailureFromResponse(response) {
  const requestId = responseRequestId(response);
  const contentType = responseType(response);
  const body = await response.clone().text().catch(() => "");
  const json = parseJsonObject(body);

  if (json) {
    return {
      ...json,
      code: json.code || `BRIEFING_HTTP_${response.status}`,
      message: json.message || infrastructureMessage(response.status, body),
      status: response.status,
      statusText: response.statusText || null,
      requestId: json.requestId || requestId,
      responseType: contentType,
    };
  }

  return {
    code: `BRIEFING_HTTP_${response.status}`,
    message: infrastructureMessage(response.status, body),
    status: response.status,
    statusText: response.statusText || null,
    requestId,
    responseType: contentType,
  };
}

export function briefingNetworkFailure(error) {
  const aborted = error?.name === "AbortError";

  return {
    code: aborted ? "BRIEFING_REQUEST_ABORTED" : "BRIEFING_NETWORK_ERROR",
    message: aborted
      ? "브리핑 요청이 완료되기 전에 취소되었습니다. 다시 시도해 주세요."
      : "브리핑 API에 연결하지 못했습니다. 네트워크 연결, 배포 상태 또는 브라우저의 요청 차단 여부를 확인해 주세요.",
    status: null,
    statusText: null,
    requestId: null,
    responseType: null,
  };
}

export function briefingStreamFailure(error, responseMeta = {}) {
  const parsed = parseJsonObject(error?.message);

  if (parsed) {
    return {
      ...parsed,
      code: parsed.code || "AI_STREAM_ERROR",
      message:
        parsed.message ||
        "AI 브리핑 스트림을 처리하는 중 오류가 발생했습니다.",
      status: parsed.status ?? responseMeta.status ?? null,
      requestId: parsed.requestId || responseMeta.requestId || null,
      responseType: responseMeta.responseType || null,
    };
  }

  return {
    code: "AI_STREAM_ERROR",
    message:
      error?.message && error.message !== "An error occurred."
        ? error.message
        : "AI 브리핑 스트림을 처리하는 중 오류가 발생했습니다.",
    status: responseMeta.status ?? null,
    statusText: responseMeta.statusText ?? null,
    requestId: responseMeta.requestId ?? null,
    responseType: responseMeta.responseType ?? null,
  };
}
