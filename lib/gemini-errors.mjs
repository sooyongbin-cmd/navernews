const QUOTA_MARKERS = [
  "RESOURCE_EXHAUSTED",
  "RATE LIMIT",
  "RATE_LIMIT",
  "QUOTA",
  "TOO MANY REQUESTS",
];

const AUTH_MARKERS = [
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "API KEY NOT VALID",
  "API_KEY_INVALID",
  "INVALID API KEY",
];

const TIMEOUT_MARKERS = [
  "ABORTERROR",
  "DEADLINE_EXCEEDED",
  "TIMED OUT",
  "TIMEOUT",
];

function normalizedErrorText(error) {
  return [
    error?.name,
    error?.code,
    error?.message,
    error?.error?.code,
    error?.error?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function numericStatus(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.error?.status,
  ];

  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }

  return null;
}

function includesMarker(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

export function geminiErrorStatus(error) {
  const status = numericStatus(error);
  if (status === 401 || status === 403 || status === 429 || status === 504) {
    return status;
  }

  const text = normalizedErrorText(error);
  if (includesMarker(text, QUOTA_MARKERS)) return 429;
  if (includesMarker(text, AUTH_MARKERS)) return status === 401 ? 401 : 403;
  if (includesMarker(text, TIMEOUT_MARKERS)) return 504;

  return status;
}

export function geminiErrorCode(error) {
  const status = geminiErrorStatus(error);
  if (status === 429) return "GEMINI_FREE_QUOTA_EXHAUSTED";
  if (status === 401 || status === 403) return "GEMINI_AUTH_ERROR";
  if (status === 504) return "GEMINI_TIMEOUT";
  return "GEMINI_UPSTREAM_ERROR";
}

export function publicGeminiErrorMessage(error) {
  const status = geminiErrorStatus(error);

  if (status === 429) {
    return "Gemini 무료 API 호출 한도를 모두 사용했습니다. Google AI Studio에서 현재 한도와 갱신 시점을 확인해 주세요.";
  }

  if (status === 401 || status === 403) {
    return "Gemini API 인증에 실패했습니다. GEMINI_API_KEY가 유효한지 Google AI Studio에서 확인해 주세요.";
  }

  if (status === 504) {
    return "Gemini가 제한 시간 안에 브리핑을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  return "Gemini API에서 정상 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
