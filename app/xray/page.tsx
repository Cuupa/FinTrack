"use client";

import { XrayView } from "@/components/xray/xray-view";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { XRAY_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

export default function XrayPage() {
  const { t } = useI18n();
  const { enabled, locked } = useFeature("xray");
  return (
    <div className="space-y-6">
      <PageHeaderWithTour
        title={t("xray.title")}
        subtitle={t("xray.subtitle")}
        tourId="xray"
        steps={XRAY_TOUR_STEPS}
        ready={enabled && !locked}
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : locked ? (
        <ProTeaser feature="xray">
          <XrayView />
        </ProTeaser>
      ) : (
        <XrayView />
      )}
    </div>
  );
}
