"use client";

import { SpendingView } from "@/components/spending/spending-view";
import { SpendingSkeleton } from "@/components/spending/spending-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { SPENDING_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function SpendingPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("spending");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("spending.title")}
        subtitle={t("spending.subtitle")}
        tourId="spending"
        steps={SPENDING_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <SpendingSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="spending">
          <SpendingView />
        </ProTeaser>
      ) : (
        <SpendingView />
      )}
    </div>
  );
}
