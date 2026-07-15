export class GeminiSseError extends Error {
  constructor(details = {}) {
    super(details.message || "Gemini 브리핑 스트림을 처리하지 못했습니다.");
    this.name = "GeminiSseError";
    this.details = details;
  }
}

function parseFrame(frame) {
  let eventName = "message";
  const dataLines = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  try {
    return {
      eventName,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    throw new GeminiSseError({
      code: "GEMINI_STREAM_PROTOCOL_ERROR",
      message: "Gemini 브리핑 스트림의 응답 형식이 올바르지 않습니다.",
    });
  }
}

export async function consumeGeminiSse(response, { onDelta } = {}) {
  if (!response.body) {
    throw new GeminiSseError({
      code: "GEMINI_STREAM_UNAVAILABLE",
      message: "Gemini 브리핑 응답 스트림을 열 수 없습니다.",
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let completion = null;

  async function handleFrame(frame) {
    const parsed = parseFrame(frame);
    if (!parsed) return;

    if (parsed.eventName === "delta") {
      const text = typeof parsed.data?.text === "string" ? parsed.data.text : "";
      if (text) await onDelta?.(text);
      return;
    }

    if (parsed.eventName === "error") {
      throw new GeminiSseError(parsed.data);
    }

    if (parsed.eventName === "complete") {
      completed = true;
      completion = parsed.data;
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replaceAll("\r\n", "\n");

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        if (frame.trim()) await handleFrame(frame);
        separatorIndex = buffer.indexOf("\n\n");
      }

      if (done) break;
    }

    if (buffer.trim()) await handleFrame(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!completed) {
    throw new GeminiSseError({
      code: "GEMINI_STREAM_INCOMPLETE",
      message: "Gemini 브리핑 연결이 완료되기 전에 종료되었습니다.",
    });
  }

  return completion;
}
