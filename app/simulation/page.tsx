"use client";

import { MonteCarloPanel } from "@/components/simulation/monte-carlo-panel";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { RiskDisclaimer } from "@/components/ui/risk-disclaimer";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function SimulationPage() {
  const { t } = useI18n();
  const enabled = useFeatureFlag("simulation");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("simulation.title")}</h1>
        <p className="text-sm text-zinc-500">{t("sim.subtitle")}</p>
      </div>
      <RiskDisclaimer />
      {enabled ? <MonteCarloPanel /> : <FeatureUnavailable />}
    </div>
  );
}
