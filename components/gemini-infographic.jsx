import { useRef } from "react";

const THEMES = {
  teal: {
    background: "#edf8f5",
    ink: "#102b29",
    accent: "#175c56",
    soft: "#d4ece7",
    line: "#91c7bf",
  },
  blue: {
    background: "#eef5fb",
    ink: "#142b3d",
    accent: "#23618a",
    soft: "#d8e9f5",
    line: "#94bdd7",
  },
  amber: {
    background: "#fff8e8",
    ink: "#342817",
    accent: "#9b6518",
    soft: "#f5e5bd",
    line: "#d8b870",
  },
  red: {
    background: "#fff2ef",
    ink: "#3b211f",
    accent: "#a24239",
    soft: "#f2d7d2",
    line: "#d99a92",
  },
  purple: {
    background: "#f7f1fb",
    ink: "#30233a",
    accent: "#714b85",
    soft: "#e8d9ef",
    line: "#bea2cc",
  },
};

const POINT_LABELS = {
  common: "공통 사실",
  difference: "관점 차이",
  uncertain: "확인할 점",
};

function splitLongWord(word, maxCharacters) {
  const chunks = [];
  for (let index = 0; index < word.length; index += maxCharacters) {
    chunks.push(word.slice(index, index + maxCharacters));
  }
  return chunks;
}

function wrapSvgText(text, maxCharacters, maxLines) {
  const words = String(text)
    .split(/\s+/)
    .flatMap((word) =>
      word.length > maxCharacters
        ? splitLongWord(word, maxCharacters)
        : [word]
    );
  const lines = [];

  for (const word of words) {
    const current = lines.at(-1) || "";
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      if (lines.length === 0) lines.push(candidate);
      else lines[lines.length - 1] = candidate;
    } else {
      lines.push(word);
    }
  }

  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].slice(
    0,
    Math.max(1, maxCharacters - 1)
  )}…`;
  return visible;
}

function SvgLines({ lines, x, y, lineHeight, ...props }) {
  return (
    <text x={x} y={y} {...props}>
      {lines.map((line, index) => (
        <tspan key={`${index}-${line}`} x={x} dy={index === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function PointIcon({ kind, x, y, color }) {
  if (kind === "common") {
    return (
      <g fill="none" stroke={color} strokeWidth="5">
        <circle cx={x - 7} cy={y} r="13" />
        <circle cx={x + 7} cy={y} r="13" />
      </g>
    );
  }

  if (kind === "difference") {
    return (
      <g fill="none" stroke={color} strokeWidth="5">
        <path d={`M${x - 17} ${y - 13}h13v26h-13z`} />
        <path d={`M${x + 4} ${y - 13}h13v26h-13z`} />
      </g>
    );
  }

  return (
    <path
      d={`M${x} ${y - 17}L${x + 18} ${y + 15}H${x - 18}Z`}
      fill="none"
      stroke={color}
      strokeWidth="5"
      strokeLinejoin="round"
    />
  );
}

export default function GeminiInfographic({ infographic }) {
  const svgRef = useRef(null);
  const theme = THEMES[infographic.theme] || THEMES.teal;
  const titleLines = wrapSvgText(infographic.title, 21, 2);
  const summaryLines = wrapSvgText(infographic.summary, 48, 2);

  function downloadSvg() {
    const svg = svgRef.current;
    if (!svg) return;

    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`],
      { type: "image/svg+xml;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `newswire-infographic-${Date.now()}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <figure className="gemini-infographic">
      <div className="gemini-infographic-heading">
        <div>
          <span>AI VISUAL BRIEF</span>
          <h3>한 장으로 보는 뉴스</h3>
          <p>동일한 Gemini 브리핑 응답을 검증된 SVG 카드로 구성했습니다.</p>
        </div>
        <button type="button" onClick={downloadSvg}>
          SVG 저장
        </button>
      </div>

      <div className="gemini-infographic-canvas">
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1200 675"
          role="img"
          aria-labelledby="gemini-infographic-svg-title gemini-infographic-svg-description"
        >
          <title id="gemini-infographic-svg-title">{infographic.title}</title>
          <desc id="gemini-infographic-svg-description">
            {infographic.summary}
          </desc>
          <rect width="1200" height="675" fill={theme.background} />
          <path d="M0 0h1200v18H0z" fill={theme.accent} />
          <circle cx="1110" cy="92" r="170" fill={theme.soft} opacity="0.7" />
          <circle cx="82" cy="640" r="130" fill={theme.soft} opacity="0.55" />

          <g
            fontFamily="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif"
            fill={theme.ink}
          >
            <rect x="60" y="53" width="180" height="34" rx="17" fill={theme.accent} />
            <text
              x="150"
              y="76"
              fill="#ffffff"
              fontSize="15"
              fontWeight="700"
              textAnchor="middle"
              letterSpacing="2"
            >
              AI NEWS BRIEF
            </text>

            <SvgLines
              lines={titleLines}
              x="60"
              y="142"
              lineHeight="53"
              fontSize="45"
              fontWeight="800"
              letterSpacing="-1.2"
            />
            <SvgLines
              lines={summaryLines}
              x="60"
              y={titleLines.length === 1 ? "219" : "248"}
              lineHeight="30"
              fontSize="21"
              fontWeight="500"
              fill={theme.accent}
            />

            {infographic.points.map((point, index) => {
              const x = 60 + index * 380;
              const pointLines = wrapSvgText(point.text, 23, 3);
              return (
                <g key={point.kind}>
                  <rect
                    x={x}
                    y="323"
                    width="340"
                    height="210"
                    rx="20"
                    fill="#ffffff"
                    stroke={theme.line}
                    strokeWidth="2"
                  />
                  <PointIcon
                    kind={point.kind}
                    x={x + 39}
                    y={365}
                    color={theme.accent}
                  />
                  <text
                    x={x + 72}
                    y="372"
                    fontSize="20"
                    fontWeight="800"
                    fill={theme.accent}
                  >
                    {POINT_LABELS[point.kind]}
                  </text>
                  <SvgLines
                    lines={pointLines}
                    x={x + 25}
                    y="424"
                    lineHeight="29"
                    fontSize="20"
                    fontWeight="600"
                  />
                  <text
                    x={x + 25}
                    y="507"
                    fontSize="15"
                    fontWeight="700"
                    fill={theme.accent}
                  >
                    출처 {point.sources.map((source) => `[${source}]`).join(" ")}
                  </text>
                </g>
              );
            })}

            <text x="60" y="594" fontSize="15" fontWeight="800" fill={theme.accent}>
              KEYWORDS
            </text>
            {infographic.keywords.map((keyword, index) => {
              const x = 60 + index * 205;
              return (
                <g key={`${index}-${keyword}`}>
                  <rect
                    x={x}
                    y="611"
                    width="185"
                    height="39"
                    rx="19.5"
                    fill={theme.soft}
                  />
                  <text
                    x={x + 92.5}
                    y="637"
                    fontSize="16"
                    fontWeight="700"
                    textAnchor="middle"
                    fill={theme.accent}
                  >
                    #{keyword}
                  </text>
                </g>
              );
            })}
            <text
              x="1140"
              y="637"
              fontSize="14"
              fontWeight="700"
              textAnchor="end"
              fill={theme.accent}
            >
              SOURCE [1] [2] [3] · NEWSWIRE
            </text>
          </g>
        </svg>
      </div>
      <figcaption>
        AI가 핵심 내용과 출처를 선정하고, 웹사이트가 고정 SVG 템플릿으로
        렌더링했습니다. 이미지 생성 API는 사용하지 않았습니다.
      </figcaption>
    </figure>
  );
}
