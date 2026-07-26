"use client";

import { DebtView } from "@/components/debt/debt-view";
import { DebtSkeleton } from "@/components/debt/debt-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { DEBT_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function DebtPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("debtPayoff");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("debt.title")}
        subtitle={t("debt.subtitle")}
        tourId="debt"
        steps={DEBT_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <DebtSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="debtPayoff">
          <DebtView />
        </ProTeaser>
      ) : (
        <DebtView />
      )}
    </div>
  );
}
