"use client";

import { FireView } from "@/components/fire/fire-view";
import { FireSkeleton } from "@/components/fire/fire-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function FirePage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const enabled = useFeatureFlag("firePlanner");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("fire.title")}</h1>
        <p className="text-sm text-zinc-500">{t("fire.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <FireSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <FireView />
      )}
    </div>
  );
}
