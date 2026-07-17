"use client";

// React context for the user's BYO LLM config (provider/model/API key).
// Backed by config-storage.ts (localStorage only, deliberately NOT part of
// the DataStore seam - see LLM_INTEGRATION.md's key-handling decision: the
// server must never hold a long-lived third-party credential). Mounted in
// components/providers.tsx at the top level since it doesn't depend on
// portfolio data.
//
// Hydration: state starts null (matches SSR/first paint, no window access)
// and the stored config is loaded in a deferred async continuation rather
// than a synchronous setState in the effect body - same idiom as
// ThemeProvider's saved-theme hydration (lib/theme/theme-context.tsx),
// required by the repo's react-hooks/set-state-in-effect build-time lint
// rule.
//
// Sign-out: lib/auth/auth-context.tsx clears the storage key directly
// (alongside the history cache) rather than through this context - see its
// comment. To keep any already-mounted provider in sync with that external
// clear (and with a sign-in bringing a different browser session's key back
// into view), the load effect also re-runs whenever the signed-in user
// changes, re-reading storage the same deferred way.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { loadLlmConfig, saveLlmConfig, clearLlmConfig, type LlmConfig } from "./config-storage";

interface LlmConfigContextValue {
  config: LlmConfig | null;
  setConfig: (config: LlmConfig) => void;
  clearConfig: () => void;
  /** True once a valid config (provider + model + non-empty key) is stored. */
  configured: boolean;
}

const LlmConfigContext = createContext<LlmConfigContextValue | null>(null);

export function LlmConfigProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [config, setConfigState] = useState<LlmConfig | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setConfigState(loadLlmConfig());
    });
  }, [user?.id]);

  const setConfig = useCallback((next: LlmConfig) => {
    setConfigState(next);
    saveLlmConfig(next);
  }, []);

  const clearConfig = useCallback(() => {
    setConfigState(null);
    clearLlmConfig();
  }, []);

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
