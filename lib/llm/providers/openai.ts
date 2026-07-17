// OpenAI (GPT) adapter. Wire format:
//   POST https://api.openai.com/v1/chat/completions
//   headers: Authorization: Bearer <key>
//   body:    { model, messages, stream: true }  (system as a role:"system" msg)
//   stream:  SSE `data:` lines with choices[0].delta.content, ended by [DONE].
//
// Only wire knowledge lives here — no React, no lib/server. See lib/llm/types.ts
// for the seam contract.

import type { ChatMessage, ChatRequest, LlmProvider, VendorRequest } from "../types";
import { proxyChat } from "../proxy-chat";

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o";

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
  };
}

function toMessages(
  messages: ChatMessage[],
  system?: string,
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) out.push({ role: m.role, content: m.content });
  return out;
}

export const openai: LlmProvider = {
  id: "openai",
  label: "OpenAI (GPT)",
  defaultModel: DEFAULT_MODEL,
  models: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],

  buildRequest(request: ChatRequest, key: string): VendorRequest {
    const body: Record<string, unknown> = {
      model: request.model || DEFAULT_MODEL,
      messages: toMessages(request.messages, request.system),
      stream: true,
    };
    if (request.maxTokens != null) body.max_tokens = request.maxTokens;
    return { url: API_URL, headers: headers(key), body };
  },

  buildPingRequest(key: string, model?: string): VendorRequest {
    return {
      url: API_URL,
      headers: headers(key),
      body: {
        model: model || DEFAULT_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      },
    };
  },

  extractDelta(data: unknown): string | null {
    // { choices: [{ delta: { content: "..." } }] }
    if (!data || typeof data !== "object") return null;
    const choices = (data as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const delta = (choices[0] as { delta?: { content?: unknown } })?.delta;
    const content = delta?.content;
    return typeof content === "string" ? content : null;
  },

  extractPingText(body: unknown): string {
    // { choices: [{ message: { content: "..." } }] }
    if (!body || typeof body !== "object") return "";
    const choices = (body as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return "";
    const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
    return typeof content === "string" ? content : "";
  },

  chat(request: ChatRequest, key: string) {
    return proxyChat("openai", request, key);
  },
};
