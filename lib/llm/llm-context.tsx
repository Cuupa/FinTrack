"use client";

// React context for the user's BYO LLM config (provider/model/API key).
// Registered users choose where the key lives (owner requirement,
// 2026-07-17): in their account (DB, `llm_settings`, cross-device, rides the
// store seam like watchlist/savings plans/tags) or only in this browser
// (`fintrack-llm` localStorage key, lib/llm/browser-config.ts). Guest Mode
// has no such choice - the guest store blob already lives in this browser,
// so it's reported as scope "browser" but always goes through the store
// seam, same as every other guest mutation.
//
// This module is a thin adapter over `usePortfolio()` (for the account-scope
// config) plus browser-config.ts (for the browser-scope config), same shape
// as lib/tags/tags-context.tsx, so it must be mounted inside
// `PortfolioProvider` (components/providers.tsx). The precedence between the
// two sources is pure and extracted into lib/llm/config-precedence.ts so it
// can be unit-tested directly.
//
// Hydration: the browser-scope config starts null (matches SSR/first paint,
// no window access) and is loaded in a deferred async continuation rather
// than a synchronous setState in the effect body - same idiom the original
// P1 provider used (config-storage.ts, commit e62a824) and required by the
// repo's react-hooks/set-state-in-effect build-time lint rule. It re-reads
// whenever the signed-in user changes (sign-in/sign-out), since
// lib/auth/auth-context.tsx clears the key on sign-out.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAuth } from "@/lib/auth/auth-context";
import type { LlmConfig } from "@/lib/types";
import {
  loadBrowserLlmConfig,
  saveBrowserLlmConfig,
  clearBrowserLlmConfig,
} from "./browser-config";
import { resolveActiveLlmConfig, type LlmConfigScope } from "./config-precedence";

export type { LlmConfig };
export type { LlmConfigScope };

interface LlmConfigContextValue {
  config: LlmConfig | null;
  /** Where the active `config` currently lives. For guests this is always
   *  "browser" (the guest blob IS the browser); meaningless to switch. */
  scope: LlmConfigScope;
  /**
   * Saves `config` in the given scope. Registered users moving from one
   * scope to the other have the key moved immediately: "account" persists
   * via the store seam and clears the browser key, "browser" writes the
   * browser key and clears the DB row (`saveLlmConfig(null)`). Guests always
   * persist via the store seam regardless of `scope` (there is no choice to
   * make), so callers with no scope control (Guest Mode's settings form) can
   * omit it.
   */
  setConfig: (config: LlmConfig, scope?: LlmConfigScope) => Promise<void>;
  /** Clears both the account row and the browser key. */
  clearConfig: () => Promise<void>;
  /** True once a valid config (provider + model + non-empty key) is stored. */
  configured: boolean;
}

const LlmConfigContext = createContext<LlmConfigContextValue | null>(null);

export function LlmConfigProvider({ children }: { children: ReactNode }) {
  const { mode, user } = useAuth();
  const {
    data,
    saveLlmConfig: storeSaveLlmConfig,
  } = usePortfolio();
  const accountConfig = data.llmConfig;

  const [browserConfig, setBrowserConfigState] = useState<LlmConfig | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setBrowserConfigState(loadBrowserLlmConfig());
    });
  }, [user?.id]);

  const { config, scope } = resolveActiveLlmConfig({ mode, accountConfig, browserConfig });

  const setConfig = useCallback(
    async (next: LlmConfig, nextScope?: LlmConfigScope) => {
      if (mode === "guest") {
        // Guests have nowhere else to put it - the guest blob is the
        // browser. Ignore the scope argument entirely.
        await storeSaveLlmConfig(next);
        return;
      }
      if (nextScope === "browser") {
        saveBrowserLlmConfig(next);
        setBrowserConfigState(next);
        await storeSaveLlmConfig(null);
      } else {
        await storeSaveLlmConfig(next);
        clearBrowserLlmConfig();
        setBrowserConfigState(null);
      }
    },
    [mode, storeSaveLlmConfig],
  );

  const clearConfig = useCallback(async () => {
    clearBrowserLlmConfig();
    setBrowserConfigState(null);
    await storeSaveLlmConfig(null);
  }, [storeSaveLlmConfig]);

  const value = useMemo<LlmConfigContextValue>(
    () => ({ config, scope, setConfig, clearConfig, configured: config !== null }),
    [config, scope, setConfig, clearConfig],
  );

  return <LlmConfigContext.Provider value={value}>{children}</LlmConfigContext.Provider>;
}

export function useLlmConfig(): LlmConfigContextValue {
  const ctx = useContext(LlmConfigContext);
  if (!ctx) throw new Error("useLlmConfig must be used within an LlmConfigProvider");
  return ctx;
}
