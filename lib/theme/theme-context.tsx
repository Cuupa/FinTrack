"use client";

// Theme provider: an explicit light/dark choice overrides the OS preference.
// Persists only the explicit choice (localStorage key "fintrack-theme");
// "system" is represented by the absence of a stored value, not a third
// value, so a later OS-preference change keeps following along until the
// user picks explicitly. A no-flash inline script in app/layout.tsx already
// applies the right "dark" class to <html> before first paint; this provider
// keeps it in sync afterwards (Tailwind v4 class-based dark variant, see the
// @custom-variant in app/globals.css).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "fintrack-theme";

type ExplicitTheme = "light" | "dark" | null;
type EffectiveTheme = "light" | "dark";

interface ThemeContextValue {
  theme: EffectiveTheme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [explicit, setExplicit] = useState<ExplicitTheme>(null);
  const [systemDark, setSystemDark] = useState(false);

  // Hydrate the saved preference + current system preference (deferred so
  // it's not a sync setState in an effect, and so SSR/first paint always
  // render the default (same idiom as I18nProvider's locale hydration).
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "light" || saved === "dark") setExplicit(saved);
      } catch {
        /* ignore */
      }
      setSystemDark(systemPrefersDark());
    });
  }, []);

  const effective: EffectiveTheme = explicit ?? (systemDark ? "dark" : "light");

  // Apply the effective theme to <html>. This is a DOM write, not state, so
  // it can run synchronously post-hydration without tripping
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", effective === "dark");
  }, [effective]);

  // While following the system (no explicit override), stay in sync with OS
  // theme changes.
  useEffect(() => {
    if (explicit !== null) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [explicit]);

  const toggle = useCallback(() => {
    const next: EffectiveTheme = effective === "dark" ? "light" : "dark";
    setExplicit(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, [effective]);

  const value = useMemo<ThemeContextValue>(() => ({ theme: effective, toggle }), [effective, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
