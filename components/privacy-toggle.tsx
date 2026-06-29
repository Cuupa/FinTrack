"use client";

// Eye / eye-off button that toggles Incognito mode. Hidden when privacy is
// locked (shared permalink) since the recipient must not be able to reveal.

import { usePrivacy } from "@/lib/privacy/privacy-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export function PrivacyToggle({ className = "" }: { className?: string }) {
  const { incognito, locked, toggle } = usePrivacy();
  const { t } = useI18n();

  if (locked) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={incognito}
      title={incognito ? t("privacy.showFigures") : t("privacy.hideFigures") }
      aria-label={incognito ? t("privacy.showFigures") : t("privacy.hideFigures") }
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        {incognito ? (
          <>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
          </>
        ) : (
          <>
            <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}
