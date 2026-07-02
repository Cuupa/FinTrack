"use client";

// Placeholder shown when a route's feature is turned off via a feature flag, so
// a direct URL to a disabled feature degrades gracefully instead of erroring.

import { Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export function FeatureUnavailable() {
  const { t } = useI18n();
  return (
    <Card>
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
          <circle cx="12" cy="12" r="9" />
          <path d="M5.6 5.6l12.8 12.8" />
        </svg>
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          {t("common.featureUnavailable")}
        </p>
        <p className="text-sm">{t("common.featureUnavailableHint")}</p>
      </div>
    </Card>
  );
}
