"use client";

// Applies the user's saved locale (profiles.locale) to the i18n context once it
// loads, so the chosen language follows the account across devices. Renders
// nothing. Guests (no saved locale) keep their localStorage/device choice.

import { useEffect, useRef } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { Locale } from "@/lib/i18n/locale";

export function LocaleSync() {
  const { data } = usePortfolio();
  const { locale, setLocale } = useI18n();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    const pl = data.profile.locale;
    if (!pl || pl === locale || applied.current === pl) return;
    if (pl !== "en" && pl !== "de") return;
    applied.current = pl;
    // Async continuation (not a synchronous setState in an effect).
    void Promise.resolve().then(() => setLocale(pl as Locale));
  }, [data.profile.locale, locale, setLocale]);

  return null;
}
