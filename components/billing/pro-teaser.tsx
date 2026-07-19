"use client";

// Shared placeholder shown in place of a locked feature's content
// (MONETIZATION.md Phase 3). A feature is "locked" when its flag is enabled
// but `feature_flags.required_plan = 'pro'` and the signed-in user's plan is
// free (`useFeature`, lib/flags/flags-context.tsx) -- distinct from a flag
// that is off outright, which stays hidden via `FeatureUnavailable` /
// `useFeatureFlag`. As of this component landing every flag is still seeded
// 'free' (Phase 2 dark launch), so this never actually renders in prod until
// the owner re-tiers a flag to 'pro' on /admin/flags.
//
// Mirrors `FeatureUnavailable`'s card shape (centered icon + headline + one
// line of copy) so a locked surface and a disabled surface read as the same
// family of empty state. The upgrade link only renders when the `billing`
// flag itself is on: with billing off, checkout is impossible, so the
// teaser explains the feature is Pro without a dead-end call to action.

import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { useFeatureFlag, type FeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export function ProTeaser({
  feature,
  className = "",
}: {
  /** The locked flag; not shown today (copy is generic) but keeps the
   *  surface addressable for a future per-feature pitch and for tests. */
  feature: FeatureFlag;
  className?: string;
}) {
  const { t } = useI18n();
  const billingEnabled = useFeatureFlag("billing");
  return (
    <Card className={className} data-locked-feature={feature}>
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-zinc-500">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8 text-zinc-400"
          aria-hidden="true"
        >
          <rect x="5" y="11" width="14" height="9" rx="1.5" />
          <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
        </svg>
        <p className="font-medium text-zinc-700 dark:text-zinc-300">{t("common.proFeature")}</p>
        <p className="text-sm">{t("common.proFeatureHint")}</p>
        {billingEnabled && (
          <Link
            href="/settings#subscription"
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {t("common.proFeatureUpgrade")}
          </Link>
        )}
      </div>
    </Card>
  );
}
