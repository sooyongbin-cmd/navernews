# 뉴스와이어 — 네이버 뉴스 검색과 AI 브리핑

검색어로 네이버 뉴스 최신 후보를 확인하고, 검색 시점에 언론사 원문의 읽기 본문을 확보할 수 있는 기사만 최대 3건 표시하는 Next.js 앱입니다. 세 기사 전문을 모두 다시 확보했을 때만 종합 브리핑을 생성하며, 기존 Vercel AI Gateway 브리핑과 Google Gemini API 직접 호출 브리핑을 각각 선택해서 사용할 수 있습니다.

## 주요 동작

1. `/api/search`가 네이버 뉴스 검색 API를 `display=10`, `sort=date`로 호출합니다.
2. 최신 후보를 5건씩 병렬로 확인하고, `robots.txt`와 `Mozilla Readability` 검사를 통과한 기사만 발행 시각 순서대로 최대 3건 선별합니다.
3. 선별된 결과가 3건이면 세 원문 URL을 5분짜리 HMAC 서명 토큰으로 묶습니다. 1~2건만 확보되면 해당 기사만 표시하고 두 AI 브리핑 버튼은 비활성화합니다.
4. 사용자가 버튼을 누르면 기존 `/api/briefing` 또는 별도의 `/api/gemini-briefing`이 실행됩니다.
5. 서버가 세 원문을 다시 확인하고 전문이 모두 추출된 경우에만 선택한 모델을 한 번 호출합니다.
6. 하나라도 유료벽, 로그인, 차단, 시간 초과, 짧은 본문이면 AI를 호출하지 않고 기사별 실패 사유를 표시합니다.

기존 패널은 Vercel AI Gateway의 `openai/gpt-5-mini`를 사용합니다. 그 아래의 Gemini 패널은 AI Gateway를 거치지 않고 공식 Google SDK로 `gemini-3.5-flash` Interactions API를 직접 호출합니다.

Gemini 브리핑은 같은 모델 응답 끝에 제목·키워드·공통 사실·관점 차이·확인할 점을 제한된 JSON으로 함께 생성합니다. 서버가 필드 길이와 `[1]`~`[3]` 출처를 검증한 뒤 브라우저가 고정된 React SVG 템플릿으로 렌더링합니다. 이미지 생성 모델이나 추가 API 호출은 사용하지 않으며 완성된 SVG는 브라우저에서 저장할 수 있습니다.

검색과 브리핑에서 추출한 기사 전문은 요청 메모리에서만 처리하며 토큰, 데이터베이스, 서버 로그 또는 브라우저 응답에 저장하지 않습니다. 검색 후 언론사 페이지 상태가 바뀔 수 있으므로 브리핑 요청 시 같은 안전 검사와 전문 추출을 다시 수행합니다.

## 로컬 실행

Node.js 20 이상을 권장합니다.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Windows PowerShell에서는 다음 명령으로 환경 파일을 복사할 수 있습니다.

```powershell
Copy-Item .env.local.example .env.local
```

`.env.local`에 다음 값을 설정합니다.

- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`: [네이버 개발자센터](https://developers.naver.com/apps)에서 발급
- `BRIEFING_SIGNING_SECRET`: 32자 이상의 무작위 비밀값
- `AI_MODEL`: `openai/gpt-5-mini` 고정
- `AI_GATEWAY_API_KEY`: 로컬 AI Gateway 인증 키
- `GEMINI_API_KEY`: [Google AI Studio](https://aistudio.google.com/app/apikey)에서 발급한 Gemini API 키
- `GEMINI_MODEL`: `gemini-3.5-flash` 고정

서명 비밀값은 다음처럼 생성할 수 있습니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Vercel 프로젝트에 연결했다면 API 키 대신 OIDC를 사용할 수 있습니다.

```bash
vercel link
vercel env pull .env.local
```

## Vercel 배포

Vercel 프로젝트의 환경 변수에 아래 값을 등록합니다.

- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`
- `BRIEFING_SIGNING_SECRET`
- `AI_MODEL=openai/gpt-5-mini`
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.5-flash`

AI Gateway를 프로젝트에서 활성화하면 배포 환경에서는 OIDC 토큰이 자동으로 갱신됩니다. 무료 운영을 위해 애플리케이션은 `openai/gpt-5-mini` 이외의 모델을 거부하며 모델 폴백과 BYOK를 설정하지 않습니다. AI Gateway 무료 크레딧 또는 호출 한도가 소진되면 브리핑 생성을 중단합니다.

Vercel은 무료 AI Gateway 크레딧을 활성화할 때 팀 계정 확인을 위해 유효한 결제 카드 등록을 요구할 수 있습니다. 카드 등록은 AI Gateway 크레딧 구매나 자동 충전 활성화와는 별개입니다. 무료 운영을 유지하려면 크레딧을 구매하거나 자동 충전을 켜지 마세요. 카드 확인을 완료하지 않으면 Gateway가 `customer_verification_required` 403 오류로 브리핑 요청을 거부합니다.

### Gemini 무료 API

Gemini 브리핑은 Vercel AI Gateway나 OIDC를 사용하지 않고 `GEMINI_API_KEY`로 Google API를 직접 호출합니다. 애플리케이션은 무료 티어 대상인 `gemini-3.5-flash` 이외의 모델을 거부하며 자동 유료 모델 폴백을 사용하지 않습니다. 무료 한도를 소진하면 `GEMINI_FREE_QUOTA_EXHAUSTED` 오류와 함께 중단됩니다.

무료 티어의 정확한 RPM·TPM·일일 한도는 프로젝트별로 다를 수 있으므로 [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)와 Google AI Studio 대시보드에서 확인해야 합니다. 무료 Gemini API에 보낸 입력과 생성 결과는 Google 제품 개선에 사용되거나 사람이 검토할 수 있으므로 민감정보·기밀정보·개인정보를 보내지 마세요. 자세한 내용은 [Gemini API 추가 약관](https://ai.google.dev/gemini-api/terms)을 확인하세요.

## 기사 전문 추출 제한

- HTTP/HTTPS의 80·443 포트만 접근합니다.
- 사설·루프백·링크 로컬·예약 IP와 해당 주소로 향하는 리다이렉트를 차단합니다.
- 기사당 8초, 3회 리다이렉트, HTML 2MB를 한도로 둡니다.
- 본문은 최소 500자·3문단, 최대 50,000자이며 세 기사 합계는 120,000자 이하여야 합니다.
- 유료벽, 로그인, JavaScript 실행, 쿠키 또는 봇 차단을 우회하지 않습니다.
- `robots.txt`를 읽을 수 없거나 수집을 금지하면 해당 기사는 실패 처리합니다.

따라서 임의의 언론사 기사 3건을 항상 요약할 수는 없습니다. 공개·상업 서비스로 확대할 경우 언론사 이용약관, 저작권 및 전문 이용 권한을 별도로 검토해야 합니다.

검색 단계에서 최대 10개 언론사 원문을 확인하므로 기존의 메타데이터 검색보다 응답 시간이 길 수 있습니다. 검색 결과의 `전문 확인` 표시는 검색 시점 기준이며, 이후 유료벽·차단 정책이나 원문 HTML이 바뀌면 브리핑 단계에서 다시 실패할 수 있습니다.

## 검증

```bash
npm test
npm run build
```

테스트는 토큰 변조·만료, 전문 미포함, SSRF 주소 차단, Readability 추출, 최신 후보 10건 중 전문 확보 성공 기사만 최대 3건 선별하는 조건, 3건 전체 성공 조건, 프롬프트 인젝션 방어 지침, Gateway·Gemini 무료 한도 오류 메시지, Gemini SSE 및 SVG 인포그래픽 데이터 검증을 확인합니다.
