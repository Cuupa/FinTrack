"use client";

import { HouseholdView } from "@/components/household/household-view";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { Card } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth/auth-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { HOUSEHOLD_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function HouseholdPage() {
  const { t } = useI18n();
  const { mode } = useAuth();
  const { enabled, locked } = useFeature("household");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("household.title")}
        subtitle={t("household.subtitle")}
        tourId="household"
        steps={HOUSEHOLD_TOUR_STEPS}
        ready={enabled && !locked && mode === "registered"}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : mode !== "registered" ? (
        <Card>
          <p className="text-sm text-zinc-500">{t("household.registeredOnly")}</p>
        </Card>
      ) : locked ? (
        <ProTeaser feature="household">
          <HouseholdView />
        </ProTeaser>
      ) : (
        <HouseholdView />
      )}
    </div>
  );
}
