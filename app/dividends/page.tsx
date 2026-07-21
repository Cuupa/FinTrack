"use client";

import { DividendsView } from "@/components/dividends/dividends-view";
import { DividendsSkeleton } from "@/components/dividends/dividends-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function DividendsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("dividends");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("div.title")}</h1>
        <p className="text-sm text-zinc-500">{t("div.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <DividendsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="dividends">
          <DividendsView />
        </ProTeaser>
      ) : (
        <DividendsView />
      )}
    </div>
  );
}
