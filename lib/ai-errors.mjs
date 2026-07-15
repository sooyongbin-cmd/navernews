function statusCodeOf(error) {
  return (
    error?.statusCode ??
    error?.status ??
    error?.cause?.statusCode ??
    error?.cause?.status
  );
}

export const AI_GATEWAY_CARD_URL =
  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card";

function errorDetailsOf(error) {
  return [
    error?.message,
    error?.type,
    error?.responseBody,
    error?.cause?.message,
    error?.cause?.type,
    error?.cause?.responseBody,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");
}

function isCardVerificationRequired(error) {
  return /customer_verification_required|valid credit card on file|unlock your free credits/i.test(
    errorDetailsOf(error)
  );
}

function isFreeModelRestricted(error) {
  return /RestrictedModelsError|free tier users do not have access to this model/i.test(
    errorDetailsOf(error)
  );
}

export function publicAiErrorMessage(error) {
  const statusCode = statusCodeOf(error);

  if (isCardVerificationRequired(error)) {
    return "AI Gateway 무료 크레딧이 잠겨 있습니다. Vercel 팀의 결제 정보에 유효한 카드를 등록해 계정 확인을 완료해 주세요. 크레딧 구매나 자동 충전은 활성화하지 않아도 됩니다.";
  }

  if (isFreeModelRestricted(error)) {
    return "현재 모델은 AI Gateway 무료 등급에서 사용할 수 없습니다. 무료 대상 모델 목록을 확인해 주세요.";
  }

  if (statusCode === 402 || statusCode === 429) {
    return "AI Gateway 무료 크레딧 또는 호출 한도를 모두 사용했습니다. 무료 한도가 갱신된 뒤 다시 시도해 주세요.";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "AI Gateway 인증을 확인할 수 없습니다. Vercel OIDC 또는 AI_GATEWAY_API_KEY 설정을 확인해 주세요.";
  }

  if (statusCode === 408 || statusCode === 504) {
    return "AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  }

  return "AI 브리핑 생성 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

export function aiErrorStatus(error) {
  return statusCodeOf(error) ?? null;
}

export function aiErrorCode(error) {
  const statusCode = statusCodeOf(error);

  if (isCardVerificationRequired(error)) {
    return "AI_GATEWAY_CARD_REQUIRED";
  }

  if (isFreeModelRestricted(error)) {
    return "AI_MODEL_NOT_FREE";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "AI_GATEWAY_AUTH_ERROR";
  }

  if (statusCode === 402 || statusCode === 429) {
    return "AI_FREE_LIMIT_REACHED";
  }

  if (statusCode === 408 || statusCode === 504) {
    return "AI_TIMEOUT";
  }

  return "AI_PROVIDER_ERROR";
}

export function aiErrorActionUrl(error) {
  return isCardVerificationRequired(error) ? AI_GATEWAY_CARD_URL : null;
}
