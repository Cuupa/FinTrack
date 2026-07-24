"use client";

import { ContractsView } from "@/components/contracts/contracts-view";
import { ContractsSkeleton } from "@/components/contracts/contracts-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function ContractsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("contracts");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("contracts.title")}</h1>
        <p className="text-sm text-zinc-500">{t("contracts.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <ContractsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <ContractsView />
      )}
    </div>
  );
}
