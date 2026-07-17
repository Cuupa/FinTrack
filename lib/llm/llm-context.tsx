"use client";

// React context for the user's BYO LLM config (provider/model/API key).
// Rides the DataStore seam (lib/store) like watchlist/savings plans/tags
// (round-22 tags precedent, owner override of LLM_INTEGRATION.md's earlier
// "localStorage only" decision 1): DB-persisted for registered users
// (`llm_settings`), localStorage-backed (inside the guest blob) for guests.
// This module is a thin adapter over `usePortfolio()`, same shape as
// lib/tags/tags-context.tsx, so it must be mounted inside `PortfolioProvider`
// (components/providers.tsx).
//
// One-time migration: the config used to live entirely in a separate
// `fintrack-llm` localStorage key, for every user (guest and registered
// alike). Once portfolio data has loaded, if the store has no config and that
// legacy key still holds a valid payload, it's replayed into the store and
// the key is renamed to `fintrack-llm-imported` so it never replays again —
// same guard shape as TagsProvider's legacy-key import.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { LlmConfig } from "@/lib/types";
import type { LlmProviderId } from "./types";

export type { LlmConfig };

const STORAGE_KEY = "fintrack-llm";
const STORAGE_KEY_IMPORTED = "fintrack-llm-imported";
const VERSION = 1;

interface PersistShape extends LlmConfig {
  version: 1;
}

const PROVIDER_IDS: readonly LlmProviderId[] = ["anthropic", "openai", "gemini"];

function isProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Parses the legacy `fintrack-llm` payload, or null if absent/malformed/a
 *  version mismatch (a future shape change bumps VERSION; old data is then
 *  treated as absent rather than misread). Exported for tests, same as
 *  TagsProvider's `migrate`. */
export function parseLegacyConfig(raw: string): LlmConfig | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistShape> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== VERSION) return null;
    if (!isProviderId(parsed.provider)) return null;
    if (typeof parsed.model !== "string" || !parsed.model) return null;
    if (typeof parsed.key !== "string" || !parsed.key) return null;
    return { provider: parsed.provider, model: parsed.model, key: parsed.key };
  } catch {
    return null;
  }
}

interface LlmConfigContextValue {
  config: LlmConfig | null;
  setConfig: (config: LlmConfig) => Promise<void>;
  clearConfig: () => Promise<void>;
  /** True once a valid config (provider + model + non-empty key) is stored. */
  configured: boolean;
}

const LlmConfigContext = createContext<LlmConfigContextValue | null>(null);

export function LlmConfigProvider({ children }: { children: ReactNode }) {
  const {
    data,
    loading,
    saveLlmConfig: storeSaveLlmConfig,
  } = usePortfolio();
  const config = data.llmConfig;

  // Guards the one-time legacy-key import against concurrent re-entry (e.g.
  // React StrictMode's double effect invocation in dev) — same pattern as
  // TagsProvider's `migrating` ref.
  const migrating = useRef(false);

  useEffect(() => {
    if (loading || migrating.current) return;
    if (config !== null) return; // store already has a config — nothing to migrate
    migrating.current = true;
    void Promise.resolve()
      .then(async () => {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return;
          const legacy = parseLegacyConfig(raw);
          if (!legacy) return;
          await storeSaveLlmConfig(legacy);
          // Keep the payload as a backup but stop it from ever replaying again.
          localStorage.setItem(STORAGE_KEY_IMPORTED, raw);
          localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
          console.error("Failed to migrate legacy localStorage LLM config", err);
        }
      })
      .finally(() => {
        migrating.current = false;
      });
  }, [loading, config, storeSaveLlmConfig]);

  const setConfig = useCallback(
    (next: LlmConfig) => storeSaveLlmConfig(next),
    [storeSaveLlmConfig],
  );

  const clearConfig = useCallback(() => storeSaveLlmConfig(null), [storeSaveLlmConfig]);

  const value = useMemo<LlmConfigContextValue>(
    () => ({ config, setConfig, clearConfig, configured: config !== null }),
    [config, setConfig, clearConfig],
  );

  return <LlmConfigContext.Provider value={value}>{children}</LlmConfigContext.Provider>;
}

export function useLlmConfig(): LlmConfigContextValue {
  const ctx = useContext(LlmConfigContext);
  if (!ctx) throw new Error("useLlmConfig must be used within an LlmConfigProvider");
  return ctx;
}
