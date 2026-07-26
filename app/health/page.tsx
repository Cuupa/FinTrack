"use client";

import { HealthView } from "@/components/health/health-view";
import { HealthSkeleton } from "@/components/health/health-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { HEALTH_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function HealthPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("finHealth");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("health.title")}
        subtitle={t("health.subtitle")}
        tourId="health"
        steps={HEALTH_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <HealthSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="finHealth">
          <HealthView />
        </ProTeaser>
      ) : (
        <HealthView />
      )}
    </div>
  );
}
