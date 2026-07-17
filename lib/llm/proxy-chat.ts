// Client-side chat helper shared by every provider's `chat()`. It POSTs to the
// server proxy (/api/llm) and yields the normalized text deltas the route
// emits. This is the one place the browser talks to the app for LLM streaming;
// it never contacts a vendor origin directly (CSP stays 'self' + supabase).
//
// The route normalizes every vendor to a single SSE shape — `data: {"delta":…}`
// frames, an optional `data: {"error":"code"}` frame, and a `data: [DONE]`
// sentinel — so this parser is provider-agnostic and reuses the shared SSE
// framing (lib/llm/sse.ts). React-free, no lib/server import.

import type { ChatRequest, StreamHandle } from "./types";
import { newSseState, pushSseChunk } from "./sse";

const PROXY_URL = "/api/llm";

/** Thrown when the proxy (or upstream) fails; `code` is an LlmErrorCode. */
export class LlmChatError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name = "LlmChatError";
    this.code = code;
    this.status = status;
  }
}

export function proxyChat(
  provider: string,
  request: ChatRequest,
  key: string,
): StreamHandle {
  const controller = new AbortController();

  async function* iterate(): AsyncGenerator<string> {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        model: request.model,
        key,
        messages: request.messages,
        system: request.system,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      let code = "providerDown";
      try {
        const err = (await res.json()) as { error?: unknown };
        if (typeof err?.error === "string") code = err.error;
      } catch {
        /* keep the default code */
      }
      throw new LlmChatError(code, res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const state = newSseState();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const payload of pushSseChunk(
          decoder.decode(value, { stream: true }),
          state,
        )) {
          let obj: { delta?: unknown; error?: unknown };
          try {
            obj = JSON.parse(payload) as { delta?: unknown; error?: unknown };
          } catch {
            continue;
          }
          if (typeof obj.error === "string") {
            throw new LlmChatError(obj.error, 200);
          }
          if (typeof obj.delta === "string") yield obj.delta;
        }
        if (state.done) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  const gen = iterate();
  return {
    [Symbol.asyncIterator]() {
      return gen;
    },
    cancel() {
      controller.abort();
    },
  };
}
