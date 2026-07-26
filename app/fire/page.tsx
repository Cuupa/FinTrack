"use client";

import { FireView } from "@/components/fire/fire-view";
import { FireSkeleton } from "@/components/fire/fire-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { FIRE_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function FirePage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("firePlanner");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("fire.title")}
        subtitle={t("fire.subtitle")}
        tourId="fire"
        steps={FIRE_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <FireSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="firePlanner">
          <FireView />
        </ProTeaser>
      ) : (
        <FireView />
      )}
    </div>
  );
}
