function statusCodeOf(error) {
  return (
    error?.statusCode ??
    error?.status ??
    error?.cause?.statusCode ??
    error?.cause?.status
  );
}

export function publicAiErrorMessage(error) {
  const statusCode = statusCodeOf(error);

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
