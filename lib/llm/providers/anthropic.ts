// Anthropic (Claude) adapter. Wire format:
//   POST https://api.anthropic.com/v1/messages
//   headers: x-api-key: <key>, anthropic-version: 2023-06-01
//   body:    { model, max_tokens, system?, messages, stream: true }
//   stream:  SSE; `content_block_delta` events carry `delta.text`.
//
// Only wire knowledge lives here — no React, no lib/server. See lib/llm/types.ts
// for the seam contract.

import type { ChatMessage, ChatRequest, LlmProvider, VendorRequest } from "../types";
import { proxyChat } from "../proxy-chat";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
// Anthropic requires max_tokens; a conversational default when the caller omits it.
const DEFAULT_MAX_TOKENS = 2048;

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

function toMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export const anthropic: LlmProvider = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  defaultModel: DEFAULT_MODEL,
  models: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],

  buildRequest(request: ChatRequest, key: string): VendorRequest {
    const body: Record<string, unknown> = {
      model: request.model || DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toMessages(request.messages),
      stream: true,
    };
    if (request.system) body.system = request.system;
    return { url: API_URL, headers: headers(key), body };
  },

  buildPingRequest(key: string, model?: string): VendorRequest {
    return {
      url: API_URL,
      headers: headers(key),
      body: {
        model: model || DEFAULT_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      },
    };
  },

  extractDelta(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const evt = data as { type?: unknown; delta?: { text?: unknown } };
    if (evt.type !== "content_block_delta") return null;
    const text = evt.delta?.text;
    return typeof text === "string" ? text : null;
  },

  extractPingText(body: unknown): string {
    // { content: [{ type: "text", text: "..." }, ...] }
    if (!body || typeof body !== "object") return "";
    const blocks = (body as { content?: unknown }).content;
    if (!Array.isArray(blocks)) return "";
    return blocks
      .map((b) =>
        b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
          ? (b as { text: string }).text
          : "",
      )
      .join("");
  },

  chat(request: ChatRequest, key: string) {
    return proxyChat("anthropic", request, key);
  },
};
