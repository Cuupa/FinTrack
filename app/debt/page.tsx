"use client";

import { DebtView } from "@/components/debt/debt-view";
import { DebtSkeleton } from "@/components/debt/debt-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function DebtPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("debtPayoff");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("debt.title")}</h1>
        <p className="text-sm text-zinc-500">{t("debt.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <DebtSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <DebtView />
      )}
    </div>
  );
}
