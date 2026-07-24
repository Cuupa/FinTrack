"use client";

import { SpendingView } from "@/components/spending/spending-view";
import { SpendingSkeleton } from "@/components/spending/spending-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function SpendingPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("spending");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("spending.title")}</h1>
        <p className="text-sm text-zinc-500">{t("spending.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <SpendingSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <SpendingView />
      )}
    </div>
  );
}
