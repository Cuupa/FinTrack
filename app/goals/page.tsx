"use client";

import { GoalsView } from "@/components/goals/goals-view";
import { GoalsSkeleton } from "@/components/goals/goals-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function GoalsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("goals");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("goals.title")}</h1>
        <p className="text-sm text-zinc-500">{t("goals.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <GoalsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <GoalsView />
      )}
    </div>
  );
}
