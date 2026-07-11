"use client";

// Locale provider: holds the active locale, persists it, mirrors it to the
// formatting layer (lib/i18n/locale + lib/format), and exposes a `t()` helper.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setActiveLocale, type Locale } from "./locale";
import { translate, type MessageKey } from "./dictionaries";

const STORAGE_KEY = "fintrack-locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Hydrate the saved preference (deferred so it's not a sync setState in an
  // effect, and so SSR/first paint always render the default). With no saved
  // preference, fall back to the browser's language — but don't persist that
  // guess to localStorage: only an explicit user choice (setLocale) should
  // stick, so a later browser-language change or a different device can still
  // take effect.
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === "en" || saved === "de") {
          setLocaleState(saved);
          setActiveLocale(saved);
          return;
        }
        const browserLang =
          typeof navigator !== "undefined" ? navigator.language : undefined;
        const guessed: Locale = browserLang?.toLowerCase().startsWith("de") ? "de" : "en";
        setLocaleState(guessed);
        setActiveLocale(guessed);
      } catch {
        /* ignore */
      }
    });
  }, []);

  // Reflect the active locale on <html lang> for a11y/BFSG compliance. This
  // is a DOM attribute write, not state, so it can run synchronously post-
  // hydration without tripping react-hooks/set-state-in-effect.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setActiveLocale(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
