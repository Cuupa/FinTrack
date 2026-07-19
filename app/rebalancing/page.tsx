"use client";

import { RebalancingView } from "@/components/rebalancing/rebalancing-view";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function RebalancingPage() {
  const { t } = useI18n();
  const { enabled, locked } = useFeature("rebalance");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("rebalancing.title")}</h1>
        <p className="text-sm text-zinc-500">{t("rebalancing.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : locked ? (
        <ProTeaser feature="rebalance" />
      ) : (
        <RebalancingView />
      )}
    </div>
  );
}
