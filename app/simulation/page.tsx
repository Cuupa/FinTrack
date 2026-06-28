"use client";

import { MonteCarloPanel } from "@/components/simulation/monte-carlo-panel";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function SimulationPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("simulation.title")}</h1>
        <p className="text-sm text-zinc-500">
          Project your long-term wealth with a Monte Carlo simulation.
        </p>
      </div>
      <MonteCarloPanel />
    </div>
  );
}
