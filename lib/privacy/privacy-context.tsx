"use client";

// Incognito ("privacy") mode: when on, absolute financial figures are blurred
// across every view (see the `.incognito` rules in globals.css + the <Private>
// wrapper). State persists in localStorage so the choice survives reloads.
//
// A `locked` flag forces incognito on and hides the toggle — used by shared
// permalinks so the recipient can't reveal the figures.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "fintrack-incognito";

interface PrivacyContextValue {
  /** True when figures should be masked. */
  incognito: boolean;
  /** True when incognito is forced and cannot be toggled off (shared view). */
  locked: boolean;
  toggle: () => void;
  setIncognito: (on: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({
  children,
  locked = false,
}: {
  children: ReactNode;
  locked?: boolean;
}) {
  const [incognito, setIncognito] = useState(locked);

  // Hydrate from localStorage once (skipped when locked — always on). Deferred
  // into a microtask so it's an async continuation, not a synchronous setState
  // in an effect (which the Next lint rule rejects) — also avoids any SSR/first-
  // paint hydration mismatch since the server always renders the `false` state.
  useEffect(() => {
    if (locked) return;
    void Promise.resolve().then(() => {
      try {
        if (localStorage.getItem(STORAGE_KEY) === "1") setIncognito(true);
      } catch {
        /* ignore */
      }
    });
  }, [locked]);

  // Reflect the state onto <html> so the CSS blur rules apply globally, and
  // persist the user's choice.
  useEffect(() => {
    const on = locked || incognito;
    document.documentElement.classList.toggle("incognito", on);
    if (locked) return;
    try {
      localStorage.setItem(STORAGE_KEY, incognito ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [incognito, locked]);

  const toggle = useCallback(() => {
    if (!locked) setIncognito((v) => !v);
  }, [locked]);

  const value = useMemo<PrivacyContextValue>(
    () => ({ incognito: locked || incognito, locked, toggle, setIncognito }),
    [incognito, locked, toggle],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within a PrivacyProvider");
  return ctx;
}
