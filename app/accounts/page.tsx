"use client";

import { AccountsView } from "@/components/accounts/accounts-view";
import { AccountsSkeleton } from "@/components/accounts/accounts-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { ACCOUNTS_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function AccountsPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("accounts");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("accounts.title")}
        subtitle={t("accounts.subtitle")}
        tourId="accounts"
        steps={ACCOUNTS_TOUR_STEPS}
        ready={enabled && !locked && !loading && !loadError}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <AccountsSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="accounts">
          <AccountsView />
        </ProTeaser>
      ) : (
        <AccountsView />
      )}
    </div>
  );
}
