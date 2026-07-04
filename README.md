# 뉴스와이어 — 네이버 뉴스 검색 웹앱

키워드를 입력하면 네이버 뉴스 검색 오픈API에서 **최신순 10건**을 가져와 보여주고,
각 뉴스 제목을 클릭하면 원문 기사로 이동합니다. Next.js(Pages Router) 기반으로
Vercel에 바로 배포할 수 있습니다.

## 1. 네이버 개발자센터 설정 (필수)

이 앱은 네이버의 **검색 오픈API(뉴스)**를 사용합니다. 아래 절차를 그대로 따라 하시면 됩니다.

1. https://developers.naver.com 접속 후 네이버 아이디로 로그인
2. 상단 메뉴 **Application → 애플리케이션 등록** 클릭
3. 등록 정보 입력
   - **애플리케이션 이름**: 원하는 이름 (예: `naver-news-search`)
   - **사용 API**: **검색** 선택 후 추가 (뉴스 검색이 "검색" API에 포함되어 있습니다)
   - **비로그인 오픈 API 서비스 환경**: **WEB 설정** 선택
   - **웹 서비스 URL**: 로컬 개발 시 `http://localhost:3000`, 배포 후에는 Vercel에서 발급받은 실제 도메인
     (예: `https://your-app.vercel.app`)을 반드시 추가해야 합니다. 여러 개 등록 가능하며,
     나중에 도메인이 확정되면 다시 등록/수정할 수 있습니다.
4. 등록 완료 후 발급되는 **Client ID**와 **Client Secret**을 확인 (Application 목록에서 언제든 재확인 가능)

### 주의사항
- 뉴스 검색 API는 **비로그인 방식**이며 트래픽 제한이 있습니다(일반적으로 일일 25,000건 수준이며 네이버 정책에 따라 변경될 수 있으니 개발자센터에서 본인 앱의 한도를 확인하세요).
- Client ID/Secret은 절대 프론트엔드(브라우저) 코드에 노출하면 안 됩니다. 이 프로젝트는
  `pages/api/search.js`라는 **서버 사이드 API Route**에서만 호출하도록 구성되어 있어 안전합니다.
- 네이버 뉴스 검색 API는 CORS를 허용하지 않으므로, 브라우저에서 직접 호출하면 실패합니다.
  반드시 서버(백엔드/API Route)를 경유해야 합니다 — 이미 이 프로젝트에 구현되어 있습니다.
- API 응답의 `link`는 네이버 뉴스 페이지로 갈 수도 있어, 이 앱은 가능하면 언론사 원문 링크인
  `originallink`를 우선 사용하도록 처리했습니다.

## 2. 로컬 실행 방법

```bash
npm install
cp .env.local.example .env.local
# .env.local 파일을 열어 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 값 입력
npm run dev
```

브라우저에서 http://localhost:3000 접속 후 키워드를 검색해 보세요.

## 3. Vercel 배포 방법

1. 이 프로젝트를 GitHub 저장소에 push
2. https://vercel.com 에서 **New Project → GitHub 저장소 선택 → Import**
3. **Environment Variables** 항목에 아래 두 값을 추가
   - `NAVER_CLIENT_ID`
   - `NAVER_CLIENT_SECRET`
4. **Deploy** 클릭
5. 배포 완료 후 발급된 도메인(예: `https://your-app.vercel.app`)을
   네이버 개발자센터 애플리케이션 설정의 **웹 서비스 URL**에 추가로 등록
   (등록해야 정상적으로 API 요청이 허용됩니다)

## 4. 프로젝트 구조

```
naver-news-app/
├── pages/
│   ├── _app.js          # 전역 폰트/스타일 적용
│   ├── index.js          # 검색 UI 및 결과 렌더링
│   └── api/
│       └── search.js     # 네이버 뉴스 검색 API를 호출하는 서버 라우트
├── styles/
│   └── globals.css
├── .env.local.example    # 환경변수 예시 (실값은 .env.local에 입력, git에 커밋 금지)
├── jsconfig.json
├── next.config.js
└── package.json
```

## 5. 동작 방식 요약

1. 사용자가 키워드 입력 후 검색 클릭
2. 프론트엔드가 `/api/search?query=키워드` 호출
3. 서버(API Route)가 `X-Naver-Client-Id`, `X-Naver-Client-Secret` 헤더를 담아
   `https://openapi.naver.com/v1/search/news.json?query=...&display=10&sort=date` 호출
4. 응답에서 HTML 태그(`<b>` 등)와 엔티티(`&quot;` 등)를 제거해 깔끔한 제목/요약으로 가공
5. 프론트엔드에서 발행 시각 최신순으로 10건을 카드 형태로 렌더링, 제목 클릭 시 새 탭에서 원문으로 이동
