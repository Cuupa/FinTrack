// Shared Server-Sent-Events line assembler for vendor streams.
//
// All three vendors (Anthropic, OpenAI, Gemini with ?alt=sse) frame their
// streams identically: `data:` lines, blank-line separators, an optional
// `[DONE]` sentinel, and chunk boundaries that can split a single line in half.
// Only the JSON *shape* of each `data:` payload differs, and that knowledge
// lives in each provider's `extractDelta`. The framing lives here, once.
//
// React-free, no lib/server import — imported by both the route (server-side
// normalization) and the client proxy (parsing the uniform normalized stream,
// which uses the very same framing).

export interface SseReaderState {
  /** Bytes of an incomplete trailing line carried to the next chunk. */
  buffer: string;
  /** Set once a `[DONE]` sentinel has been seen. */
  done: boolean;
}

export function newSseState(): SseReaderState {
  return { buffer: "", done: false };
}

/**
 * Feed a decoded chunk of SSE text. Returns the raw `data:` payload strings
 * found in complete lines (the `[DONE]` sentinel is consumed and flips
 * `state.done` instead of being returned). A trailing partial line is retained
 * in `state.buffer` for the next call, so payloads split across chunk
 * boundaries are reassembled correctly.
 */
export function pushSseChunk(chunk: string, state: SseReaderState): string[] {
  state.buffer += chunk;
  const payloads: string[] = [];
  let idx: number;
  while ((idx = state.buffer.indexOf("\n")) !== -1) {
    let line = state.buffer.slice(0, idx);
    state.buffer = state.buffer.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1); // tolerate CRLF
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) continue; // event:, id:, comments, blanks
    const data = trimmed.slice("data:".length).trim();
    if (data === "") continue;
    if (data === "[DONE]") {
      state.done = true;
      continue;
    }
    payloads.push(data);
  }
  return payloads;
}

/**
 * Feed a chunk and return the text deltas it yields, applying `extract` to each
 * parsed payload. Malformed JSON lines are skipped (defensive parsing), and
 * payloads that carry no text (extract -> null/"") are dropped.
 */
export function pushDeltas(
  chunk: string,
  state: SseReaderState,
  extract: (data: unknown) => string | null,
): string[] {
  const out: string[] = [];
  for (const payload of pushSseChunk(chunk, state)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // skip a malformed / unexpected line rather than throwing
    }
    const text = extract(parsed);
    if (text) out.push(text);
  }
  return out;
}
