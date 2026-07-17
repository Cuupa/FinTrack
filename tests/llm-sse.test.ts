// Shared SSE reader: framing, the [DONE] sentinel, mid-line chunk boundaries,
// and defensive JSON skipping — fed with synthetic vendor SSE for all three
// adapters through their extractDelta.

import { describe, expect, it } from "vitest";
import { newSseState, pushDeltas, pushSseChunk } from "../lib/llm/sse";
import { anthropic } from "../lib/llm/providers/anthropic";
import { openai } from "../lib/llm/providers/openai";
import { gemini } from "../lib/llm/providers/gemini";

/** Feed a string in fixed-size slices to exercise chunk boundaries. */
function feedInSlices(
  text: string,
  size: number,
  extract: (d: unknown) => string | null,
): string {
  const state = newSseState();
  let out = "";
  for (let i = 0; i < text.length; i += size) {
    for (const d of pushDeltas(text.slice(i, i + size), state, extract)) out += d;
  }
  return out;
}

describe("pushSseChunk framing", () => {
  it("reassembles a data line split across two chunks", () => {
    const state = newSseState();
    expect(pushSseChunk('data: {"a"', state)).toEqual([]); // partial line held
    expect(pushSseChunk(':1}\n', state)).toEqual(['{"a":1}']);
  });

  it("consumes the [DONE] sentinel and flips state.done", () => {
    const state = newSseState();
    const out = pushSseChunk("data: [DONE]\n", state);
    expect(out).toEqual([]);
    expect(state.done).toBe(true);
  });

  it("ignores event:/id:/comment/blank lines and tolerates CRLF", () => {
    const state = newSseState();
    const out = pushSseChunk("event: ping\r\n: comment\r\ndata: {\"x\":1}\r\n\r\n", state);
    expect(out).toEqual(['{"x":1}']);
  });
});

describe("pushDeltas defensive parsing", () => {
  it("skips malformed JSON lines without throwing", () => {
    const state = newSseState();
    const out = pushDeltas('data: not json\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n', state, (d) =>
      anthropic.extractDelta(d),
    );
    expect(out).toEqual(["ok"]);
  });
});

describe("anthropic stream", () => {
  const sse =
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", world"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';

  it("extracts text deltas and ignores non-text events", () => {
    expect(feedInSlices(sse, 1000, (d) => anthropic.extractDelta(d))).toBe("Hello, world");
  });

  it("survives byte-by-byte chunk boundaries", () => {
    expect(feedInSlices(sse, 1, (d) => anthropic.extractDelta(d))).toBe("Hello, world");
  });

  it("ignores thinking_delta (no text field)", () => {
    const state = newSseState();
    const out = pushDeltas(
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n',
      state,
      (d) => anthropic.extractDelta(d),
    );
    expect(out).toEqual([]);
  });
});

describe("openai stream", () => {
  const sse =
    'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
    "data: [DONE]\n\n";

  it("extracts choices[0].delta.content and stops at [DONE]", () => {
    expect(feedInSlices(sse, 7, (d) => openai.extractDelta(d))).toBe("Hello");
  });

  it("survives mid-line chunk boundaries", () => {
    expect(feedInSlices(sse, 3, (d) => openai.extractDelta(d))).toBe("Hello");
  });
});

describe("gemini stream", () => {
  const sse =
    'data: {"candidates":[{"content":{"parts":[{"text":"Guten"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"parts":[{"text":" Tag"}]}}]}\n\n';

  it("extracts candidates[0].content.parts[].text", () => {
    expect(feedInSlices(sse, 1000, (d) => gemini.extractDelta(d))).toBe("Guten Tag");
  });

  it("survives byte-by-byte chunk boundaries", () => {
    expect(feedInSlices(sse, 1, (d) => gemini.extractDelta(d))).toBe("Guten Tag");
  });
});
