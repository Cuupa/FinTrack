// Client-side LLM config storage (lib/llm/config-storage.ts). Same in-memory
// Storage stub pattern as tests/site-config-cache.test.ts and
// tests/history-cache.test.ts (no DOM/localStorage in the node test
// environment).

import { describe, expect, it } from "vitest";
import { loadLlmConfig, saveLlmConfig, clearLlmConfig } from "../lib/llm/config-storage";
import type { LlmConfig } from "../lib/llm/config-storage";

function makeStorage(opts?: { failAlways?: boolean }): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts?.failAlways) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const SAMPLE: LlmConfig = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  key: "sk-test-123",
};

describe("llm config-storage", () => {
  it("round-trips a write then read", () => {
    const storage = makeStorage();
    saveLlmConfig(SAMPLE, { storage });
    expect(loadLlmConfig({ storage })).toEqual(SAMPLE);
  });

  it("misses when nothing is stored", () => {
    const storage = makeStorage();
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-llm", "{not json");
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-llm", JSON.stringify(["array", "not", "object"]));
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("returns null when the version doesn't match (future/older schema)", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-llm", JSON.stringify({ version: 2, ...SAMPLE }));
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("returns null for an unknown provider id", () => {
    const storage = makeStorage();
    storage.setItem(
      "fintrack-llm",
      JSON.stringify({ version: 1, provider: "not-a-provider", model: "x", key: "y" }),
    );
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("returns null when model or key is missing or empty", () => {
    const storage = makeStorage();
    storage.setItem(
      "fintrack-llm",
      JSON.stringify({ version: 1, provider: "anthropic", model: "", key: "y" }),
    );
    expect(loadLlmConfig({ storage })).toBeNull();

    storage.setItem(
      "fintrack-llm",
      JSON.stringify({ version: 1, provider: "anthropic", model: "x" }),
    );
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("gives up silently on a QuotaExceededError during write", () => {
    const storage = makeStorage({ failAlways: true });
    expect(() => saveLlmConfig(SAMPLE, { storage })).not.toThrow();
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("clear removes a stored config", () => {
    const storage = makeStorage();
    saveLlmConfig(SAMPLE, { storage });
    clearLlmConfig({ storage });
    expect(loadLlmConfig({ storage })).toBeNull();
  });

  it("clear is a no-op when nothing is stored", () => {
    const storage = makeStorage();
    expect(() => clearLlmConfig({ storage })).not.toThrow();
  });

  it("returns null / no-ops when window is unavailable (SSR) and no storage is injected", () => {
    expect(loadLlmConfig()).toBeNull();
    expect(() => saveLlmConfig(SAMPLE)).not.toThrow();
    expect(() => clearLlmConfig()).not.toThrow();
  });
});
