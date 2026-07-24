"use client";

import { HealthView } from "@/components/health/health-view";
import { HealthSkeleton } from "@/components/health/health-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function HealthPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("finHealth");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("health.title")}</h1>
        <p className="text-sm text-zinc-500">{t("health.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <HealthSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <HealthView />
      )}
    </div>
  );
}
