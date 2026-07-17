// Google (Gemini) adapter. Wire format:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse
//   headers: x-goog-api-key: <key>   (key stays in a header, never the URL)
//   body:    { contents: [{ role: "user"|"model", parts: [{ text }] }],
//             systemInstruction?: { parts: [{ text }] } }
//   stream:  SSE `data:` JSON with candidates[0].content.parts[].text.
//
// Only wire knowledge lives here — no React, no lib/server. See lib/llm/types.ts
// for the seam contract.

import type { ChatMessage, ChatRequest, LlmProvider, VendorRequest } from "../types";
import { proxyChat } from "../proxy-chat";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-goog-api-key": key,
  };
}

function toContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  return messages.map((m) => ({
    // Gemini uses "model" for the assistant role.
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function body(request: ChatRequest): Record<string, unknown> {
  const b: Record<string, unknown> = { contents: toContents(request.messages) };
  if (request.system) b.systemInstruction = { parts: [{ text: request.system }] };
  if (request.maxTokens != null) b.generationConfig = { maxOutputTokens: request.maxTokens };
  return b;
}

export const gemini: LlmProvider = {
  id: "gemini",
  label: "Google (Gemini)",
  defaultModel: DEFAULT_MODEL,
  models: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],

  buildRequest(request: ChatRequest, key: string): VendorRequest {
    const model = request.model || DEFAULT_MODEL;
    return {
      url: `${BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: headers(key),
      body: body(request),
    };
  },

  buildPingRequest(key: string, model?: string): VendorRequest {
    const m = model || DEFAULT_MODEL;
    return {
      url: `${BASE}/${encodeURIComponent(m)}:generateContent`,
      headers: headers(key),
      body: {
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 },
      },
    };
  },

  extractDelta(data: unknown): string | null {
    return textFromCandidates(data);
  },

  extractPingText(body: unknown): string {
    return textFromCandidates(body) ?? "";
  },

  chat(request: ChatRequest, key: string) {
    return proxyChat("gemini", request, key);
  },
};

/** Concatenate candidates[0].content.parts[].text, or null when absent. */
function textFromCandidates(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return null;
  let text = "";
  for (const p of parts) {
    if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") {
      text += (p as { text: string }).text;
    }
  }
  return text || null;
}
