import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeminiInfographicSplitter,
  INFOGRAPHIC_END_MARKER,
  INFOGRAPHIC_START_MARKER,
  parseGeminiInfographicBlock,
  validateGeminiInfographic,
} from "../lib/gemini-infographic.mjs";

const INFOGRAPHIC = {
  title: "세 기사가 전한 핵심 변화",
  summary: "공통 사실과 관점 차이, 아직 확인할 내용을 한 장에 정리했습니다.",
  keywords: ["공통사실", "관점차이", "추가확인"],
  points: [
    { kind: "common", text: "세 기사가 공통으로 확인한 사실", sources: [1, 2, 3] },
    { kind: "difference", text: "기사별로 강조한 관점의 차이", sources: [1, 2] },
    { kind: "uncertain", text: "후속 보도로 확인해야 할 내용", sources: [2, 3] },
  ],
  theme: "teal",
};

test("유효한 인포그래픽 데이터만 정규화해 허용한다", () => {
  assert.deepEqual(validateGeminiInfographic(INFOGRAPHIC), INFOGRAPHIC);
});

test("세 출처를 모두 사용하지 않은 인포그래픽을 거부한다", () => {
  const invalid = structuredClone(INFOGRAPHIC);
  invalid.points = invalid.points.map((point) => ({ ...point, sources: [1] }));

  assert.throws(
    () => validateGeminiInfographic(invalid),
    /collectively cite all sources/
  );
});

test("스트림에서 분할된 마커 뒤 JSON만 브리핑과 분리한다", () => {
  const splitter = createGeminiInfographicSplitter();
  const raw = [
    "## 종합 요약\n사실 [1] 차이 [2] 확인 [3]\n",
    INFOGRAPHIC_START_MARKER,
    `\n${JSON.stringify(INFOGRAPHIC)}\n`,
    INFOGRAPHIC_END_MARKER,
  ].join("");
  const chunks = [raw.slice(0, 17), raw.slice(17, 49), raw.slice(49, 81), raw.slice(81)];
  let briefing = "";

  for (const chunk of chunks) briefing += splitter.push(chunk);
  const completed = splitter.finish();
  briefing += completed.briefingText;

  assert.equal(briefing, "## 종합 요약\n사실 [1] 차이 [2] 확인 [3]\n");
  assert.deepEqual(
    parseGeminiInfographicBlock(completed.infographicBlock),
    INFOGRAPHIC
  );
});

test("종료 마커 뒤 추가 출력이 있으면 인포그래픽을 거부한다", () => {
  assert.throws(
    () =>
      parseGeminiInfographicBlock(
        `${JSON.stringify(INFOGRAPHIC)}\n${INFOGRAPHIC_END_MARKER}\n추가 문장`
      ),
    /Unexpected content/
  );
});
