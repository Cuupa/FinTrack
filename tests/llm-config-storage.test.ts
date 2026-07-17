// Legacy `fintrack-llm` localStorage payload parsing (lib/llm/llm-context.tsx
// `parseLegacyConfig`), used only by LlmConfigProvider's one-time replay into
// the DataStore seam now that the config lives there (round-22 tags
// precedent). Same shape as tests/tags.test.ts's `migrate` tests: this module
// no longer owns persistence itself (lib/store/local-store.ts +
// lib/store/supabase-store.ts do, covered in tests/local-store.test.ts), only
// the legacy-shape parsing that feeds the replay.

import { describe, expect, it } from "vitest";
import { parseLegacyConfig } from "../lib/llm/llm-context";

const SAMPLE_RAW = JSON.stringify({
  version: 1,
  provider: "anthropic",
  model: "claude-sonnet-5",
  key: "sk-test-123",
});

describe("parseLegacyConfig", () => {
  it("parses a valid v1 payload", () => {
    expect(parseLegacyConfig(SAMPLE_RAW)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      key: "sk-test-123",
    });
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseLegacyConfig("{not json")).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(parseLegacyConfig(JSON.stringify(["array", "not", "object"]))).toBeNull();
  });

  it("returns null when the version doesn't match (future/older schema)", () => {
    expect(
      parseLegacyConfig(
        JSON.stringify({ version: 2, provider: "anthropic", model: "x", key: "y" }),
      ),
    ).toBeNull();
  });

  it("returns null for an unknown provider id", () => {
    expect(
      parseLegacyConfig(
        JSON.stringify({ version: 1, provider: "not-a-provider", model: "x", key: "y" }),
      ),
    ).toBeNull();
  });

  it("returns null when model or key is missing or empty", () => {
    expect(
      parseLegacyConfig(JSON.stringify({ version: 1, provider: "anthropic", model: "", key: "y" })),
    ).toBeNull();
    expect(
      parseLegacyConfig(JSON.stringify({ version: 1, provider: "anthropic", model: "x" })),
    ).toBeNull();
  });
});
