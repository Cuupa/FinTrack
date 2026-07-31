"use client";

import { PensionView } from "@/components/pension/pension-view";
import { PensionSkeleton } from "@/components/pension/pension-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { PENSION_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function PensionPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("pension");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("pension.title")}
        subtitle={t("pension.subtitle")}
        tourId="pension"
        steps={PENSION_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <PensionSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="pension">
          <PensionView />
        </ProTeaser>
      ) : (
        <PensionView />
      )}
    </div>
  );
}
