// Provider request mappers (neutral ChatRequest -> vendor wire format) and the
// ping-response text extractors, for all three adapters. These are the pure
// vendor-knowledge functions behind the LlmProvider seam.

import { describe, expect, it } from "vitest";
import { anthropic } from "../lib/llm/providers/anthropic";
import { openai } from "../lib/llm/providers/openai";
import { gemini } from "../lib/llm/providers/gemini";
import { getProvider, providerList } from "../lib/llm";
import type { ChatRequest } from "../lib/llm/types";

const REQUEST: ChatRequest = {
  model: "",
  system: "You are helpful.",
  messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "How is my portfolio?" },
  ],
};

describe("registry", () => {
  it("resolves every provider by id and lists them", () => {
    expect(getProvider("anthropic")).toBe(anthropic);
    expect(getProvider("openai")).toBe(openai);
    expect(getProvider("gemini")).toBe(gemini);
    expect(getProvider("nope")).toBeUndefined();
    expect(providerList.map((p) => p.id)).toEqual(["anthropic", "openai", "gemini"]);
  });

  it("each provider carries a curated model list including its default", () => {
    for (const p of providerList) {
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.models.map((m) => m.id)).toContain(p.defaultModel);
    }
  });
});

describe("anthropic.buildRequest", () => {
  it("maps to the v1/messages wire format with x-api-key + version", () => {
    const v = anthropic.buildRequest(REQUEST, "sk-ant-123");
    expect(v.url).toBe("https://api.anthropic.com/v1/messages");
    expect(v.headers["x-api-key"]).toBe("sk-ant-123");
    expect(v.headers["anthropic-version"]).toBe("2023-06-01");
    expect(v.headers.authorization).toBeUndefined();
    const body = v.body as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5"); // default when model empty
    expect(body.stream).toBe(true);
    expect(typeof body.max_tokens).toBe("number");
    expect(body.system).toBe("You are helpful.");
    // system is NOT a message; messages keep their roles verbatim
    expect(body.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How is my portfolio?" },
    ]);
  });

  it("omits system when absent and honors an explicit model", () => {
    const v = anthropic.buildRequest(
      { model: "claude-opus-4-8", messages: [{ role: "user", content: "x" }] },
      "k",
    );
    const body = v.body as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-4-8");
    expect("system" in body).toBe(false);
  });

  it("ping is a 1-token non-streamed request", () => {
    const v = anthropic.buildPingRequest("k");
    const body = v.body as Record<string, unknown>;
    expect(body.max_tokens).toBe(1);
    expect(body.stream).toBe(false);
  });

  it("extractPingText concatenates content text blocks", () => {
    expect(
      anthropic.extractPingText({ content: [{ type: "text", text: "he" }, { type: "text", text: "llo" }] }),
    ).toBe("hello");
    expect(anthropic.extractPingText({})).toBe("");
  });
});

describe("openai.buildRequest", () => {
  it("maps to chat/completions with Bearer auth and system as a role message", () => {
    const v = openai.buildRequest(REQUEST, "sk-oai-123");
    expect(v.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(v.headers.authorization).toBe("Bearer sk-oai-123");
    const body = v.body as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How is my portfolio?" },
    ]);
  });

  it("drops the system message when there is no system prompt", () => {
    const v = openai.buildRequest({ model: "", messages: [{ role: "user", content: "x" }] }, "k");
    const body = v.body as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: "user", content: "x" }]);
  });

  it("extractPingText reads choices[0].message.content", () => {
    expect(openai.extractPingText({ choices: [{ message: { content: "ok" } }] })).toBe("ok");
    expect(openai.extractPingText({ choices: [] })).toBe("");
  });
});

describe("gemini.buildRequest", () => {
  it("maps to streamGenerateContent with x-goog-api-key and model->role mapping", () => {
    const v = gemini.buildRequest(REQUEST, "goog-123");
    expect(v.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    expect(v.headers["x-goog-api-key"]).toBe("goog-123");
    // key must NOT be in the URL
    expect(v.url).not.toContain("goog-123");
    const body = v.body as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are helpful." }] });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Hi" }] },
      { role: "model", parts: [{ text: "Hello!" }] },
      { role: "user", parts: [{ text: "How is my portfolio?" }] },
    ]);
  });

  it("uses the model in the path and generateContent for ping", () => {
    const v = gemini.buildRequest({ model: "gemini-2.5-pro", messages: [{ role: "user", content: "x" }] }, "k");
    expect(v.url).toContain("/models/gemini-2.5-pro:streamGenerateContent");
    const ping = gemini.buildPingRequest("k", "gemini-2.5-pro");
    expect(ping.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    );
  });

  it("extractPingText reads candidates[0].content.parts[].text", () => {
    expect(
      gemini.extractPingText({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }),
    ).toBe("ab");
    expect(gemini.extractPingText({ candidates: [] })).toBe("");
  });
});
