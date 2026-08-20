"use client";

import { DividendsView } from "@/components/dividends/dividends-view";
import { DividendsSkeleton } from "@/components/dividends/dividends-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { PageScope } from "@/components/page-scope";
import { DIVIDENDS_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function DividendsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("dividends");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("div.title")}
        subtitle={t("div.subtitle")}
        tourId="dividends"
        steps={DIVIDENDS_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
        scope={<PageScope />}
      />
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
