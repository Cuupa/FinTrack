"use client";

// Names the features whose data failed to load, while the rest of the app
// keeps working (owner rule, round 27).
//
// A schema lagging its migration used to take everything down: one missing
// table threw out of SupabaseStore.load(), the provider set loadError, and
// every page said "could not load your data" — the depot included, which does
// not read that table at all. The store now degrades per feature and names
// what broke; this is where the user finds out, instead of silently seeing an
// empty Accounts page and concluding their data is gone.

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export function DegradedBanner() {
  const { data } = usePortfolio();
  const { t } = useI18n();
  const degraded = data.degraded ?? [];

  if (degraded.length === 0) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden>⚠️</span>
        <span>{t("degraded.banner", { areas: degraded.map((d) => d.resource).join(", ") })}</span>
        {/* The database's own words: "could not load" alone turned a one-line
            schema fix into an unfixable-looking outage. */}
        <span className="text-xs opacity-80">{degraded[0].reason}</span>
      </div>
    </div>
  );
}
