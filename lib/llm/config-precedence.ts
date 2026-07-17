// Pure precedence logic for where the active LLM config comes from
// (lib/llm/llm-context.tsx). Extracted so the decision - which of the two
// possible sources wins, and what scope that implies - is unit-testable
// without mounting the provider tree.
//
// Registered users can store their key in their account (DB, `llmConfig` on
// PortfolioData) or in this browser only (`lib/llm/browser-config.ts`). The
// browser-local key wins when present: its mere presence means the user
// chose browser scope, and it must never be silently shadowed by a stale
// account row. Guest Mode has only one place a config can live - the guest
// store blob IS the browser - so scope is reported as "browser" there
// unconditionally, but the config always comes from `accountConfig` (the
// store seam), never from `browser-config.ts` directly.

import type { LlmConfig } from "../types";

export type LlmConfigScope = "account" | "browser";

export interface ResolveActiveLlmConfigParams {
  mode: "guest" | "registered";
  /** `data.llmConfig` from the store seam (DB row for registered, guest blob for guests). */
  accountConfig: LlmConfig | null;
  /** The browser-local `fintrack-llm` key, or null if absent/unloaded. Ignored for guests. */
  browserConfig: LlmConfig | null;
}

export interface ResolvedLlmConfig {
  config: LlmConfig | null;
  scope: LlmConfigScope;
}

export function resolveActiveLlmConfig({
  mode,
  accountConfig,
  browserConfig,
}: ResolveActiveLlmConfigParams): ResolvedLlmConfig {
  if (mode === "guest") {
    return { config: accountConfig, scope: "browser" };
  }
  if (browserConfig !== null) {
    return { config: browserConfig, scope: "browser" };
  }
  // Nothing in the browser (or not yet checked) - the account row is
  // authoritative, and "account" is the sensible default scope for a form
  // that has no config configured at all yet.
  return { config: accountConfig, scope: "account" };
}
