"use client";

import { MonteCarloPanel } from "@/components/simulation/monte-carlo-panel";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { RiskDisclaimer } from "@/components/ui/risk-disclaimer";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function SimulationPage() {
  const { t } = useI18n();
  const { enabled, locked } = useFeature("simulation");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("simulation.title")}</h1>
        <p className="text-sm text-zinc-500">{t("sim.subtitle")}</p>
      </div>
      <RiskDisclaimer />
      {!enabled ? (
        <FeatureUnavailable />
      ) : locked ? (
        <ProTeaser feature="simulation" />
      ) : (
        <MonteCarloPanel />
      )}
    </div>
  );
}
