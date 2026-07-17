// Pure precedence logic between the two places a registered user's LLM
// config can live (lib/llm/config-precedence.ts): the account row (store
// seam) and the browser-local `fintrack-llm` key. Extracted from
// lib/llm/llm-context.tsx specifically so this decision is unit-testable
// without mounting the provider tree / a DOM.

import { describe, expect, it } from "vitest";
import { resolveActiveLlmConfig } from "../lib/llm/config-precedence";
import type { LlmConfig } from "../lib/types";

const ACCOUNT: LlmConfig = { provider: "anthropic", model: "claude-sonnet-5", key: "sk-account" };
const BROWSER: LlmConfig = { provider: "openai", model: "gpt-5", key: "sk-browser" };

describe("resolveActiveLlmConfig", () => {
  it("guest: reports the account (store-seam/guest-blob) config with scope 'browser'", () => {
    expect(
      resolveActiveLlmConfig({ mode: "guest", accountConfig: ACCOUNT, browserConfig: null }),
    ).toEqual({ config: ACCOUNT, scope: "browser" });
  });

  it("guest: null config stays null even with scope 'browser'", () => {
    expect(
      resolveActiveLlmConfig({ mode: "guest", accountConfig: null, browserConfig: null }),
    ).toEqual({ config: null, scope: "browser" });
  });

  it("guest: a browser-local key present is ignored entirely (guests have no browser scope)", () => {
    expect(
      resolveActiveLlmConfig({ mode: "guest", accountConfig: ACCOUNT, browserConfig: BROWSER }),
    ).toEqual({ config: ACCOUNT, scope: "browser" });
  });

  it("registered: falls back to the account config with scope 'account' when no browser key exists", () => {
    expect(
      resolveActiveLlmConfig({ mode: "registered", accountConfig: ACCOUNT, browserConfig: null }),
    ).toEqual({ config: ACCOUNT, scope: "account" });
  });

  it("registered: a browser-local key wins over the account row", () => {
    expect(
      resolveActiveLlmConfig({
        mode: "registered",
        accountConfig: ACCOUNT,
        browserConfig: BROWSER,
      }),
    ).toEqual({ config: BROWSER, scope: "browser" });
  });

  it("registered: a browser-local key wins even when there is no account row", () => {
    expect(
      resolveActiveLlmConfig({ mode: "registered", accountConfig: null, browserConfig: BROWSER }),
    ).toEqual({ config: BROWSER, scope: "browser" });
  });

  it("registered: nothing configured anywhere defaults to scope 'account'", () => {
    expect(
      resolveActiveLlmConfig({ mode: "registered", accountConfig: null, browserConfig: null }),
    ).toEqual({ config: null, scope: "account" });
  });
});
