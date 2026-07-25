"use client";

import { GoalsView } from "@/components/goals/goals-view";
import { GoalsSkeleton } from "@/components/goals/goals-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { GOALS_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function GoalsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("goals");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("goals.title")}
        subtitle={t("goals.subtitle")}
        tourId="goals"
        steps={GOALS_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <GoalsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="goals">
          <GoalsView />
        </ProTeaser>
      ) : (
        <GoalsView />
      )}
    </div>
  );
}
