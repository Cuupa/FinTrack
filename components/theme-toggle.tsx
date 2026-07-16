"use client";

// Sun / moon button that toggles explicit light/dark mode (lib/theme).

import { useTheme } from "@/lib/theme/theme-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";

export function ThemeToggle({
  className = "",
  dataTour,
}: {
  className?: string;
  /** `data-tour` target name for the guided tour (components/onboarding);
   *  passed only at the single call site the tour should spotlight, since
   *  the selector picks the first visible match. */
  dataTour?: string;
}) {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const { updateProfile } = usePortfolio();

  const label = theme === "dark" ? t("theme.toggleToLight") : t("theme.toggleToDark");

  return (
    <button
      type="button"
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        toggle();
        // Persist the choice to the profile (DB for registered users), same
        // as LocaleSwitcher persists profile.locale.
        void updateProfile({ theme: next });
      }}
      title={label}
      aria-label={label}
      data-tour={dataTour}
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
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </>
        ) : (
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        )}
      </svg>
    </button>
  );
}
