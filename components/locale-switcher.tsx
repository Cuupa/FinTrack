"use client";

// Compact language toggle (EN/DE) that drives the i18n locale + Intl formatting.

import { useI18n } from "@/lib/i18n/i18n-context";
import { LOCALES } from "@/lib/i18n/locale";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  const { updateProfile } = usePortfolio();
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => {
            setLocale(l.code);
            // Persist the choice to the profile (DB for registered users).
            void updateProfile({ locale: l.code });
          }}
          aria-pressed={locale === l.code}
          className={`rounded-md px-2 py-1 text-xs font-medium uppercase transition-colors ${
            locale === l.code
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {l.code}
        </button>
      ))}
    </div>
  );
}
