// Browser-scope LLM config storage (lib/llm/browser-config.ts). Same
// in-memory Storage stub pattern as tests/site-config-cache.test.ts and
// tests/history-cache.test.ts (no DOM/localStorage in the node test
// environment). This module backs the "only in this browser" scope choice
// registered users get in Settings (lib/llm/llm-context.tsx); Guest Mode's
// config still rides the store seam and is covered by
// tests/local-store.test.ts, untouched here.

import { describe, expect, it } from "vitest";
import {
  loadBrowserLlmConfig,
  saveBrowserLlmConfig,
  clearBrowserLlmConfig,
} from "../lib/llm/browser-config";
import type { LlmConfig } from "../lib/types";

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

describe("llm browser-config", () => {
  it("round-trips a write then read", () => {
    const storage = makeStorage();
    saveBrowserLlmConfig(SAMPLE, { storage });
    expect(loadBrowserLlmConfig({ storage })).toEqual(SAMPLE);
  });

  it("misses when nothing is stored", () => {
    const storage = makeStorage();
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-llm", "{not json");
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-llm", JSON.stringify(["array", "not", "object"]));
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("returns null when the version doesn't match (future/older schema)", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-llm", JSON.stringify({ version: 2, ...SAMPLE }));
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("returns null for an unknown provider id", () => {
    const storage = makeStorage();
    storage.setItem(
      "fintrack-llm",
      JSON.stringify({ version: 1, provider: "not-a-provider", model: "x", key: "y" }),
    );
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("returns null when model or key is missing or empty", () => {
    const storage = makeStorage();
    storage.setItem(
      "fintrack-llm",
      JSON.stringify({ version: 1, provider: "anthropic", model: "", key: "y" }),
    );
    expect(loadBrowserLlmConfig({ storage })).toBeNull();

    storage.setItem(
      "fintrack-llm",
      JSON.stringify({ version: 1, provider: "anthropic", model: "x" }),
    );
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("gives up silently on a QuotaExceededError during write", () => {
    const storage = makeStorage({ failAlways: true });
    expect(() => saveBrowserLlmConfig(SAMPLE, { storage })).not.toThrow();
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });

  it("clear removes a stored config", () => {
    const storage = makeStorage();
    saveBrowserLlmConfig(SAMPLE, { storage });
    clearBrowserLlmConfig({ storage });
    expect(loadBrowserLlmConfig({ storage })).toBeNull();
  });
});
