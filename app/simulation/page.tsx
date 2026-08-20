"use client";

import { Suspense } from "react";
import { MonteCarloPanel } from "@/components/simulation/monte-carlo-panel";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { RiskDisclaimer } from "@/components/ui/risk-disclaimer";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageScope } from "@/components/page-scope";

export default function SimulationPage() {
  const { t } = useI18n();
  const { enabled, locked } = useFeature("simulation");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("simulation.title")}</h1>
          <p className="text-sm text-zinc-500">{t("sim.subtitle")}</p>
        </div>
        <PageScope />
      </div>
      <RiskDisclaimer />
      {/* The panel reads `?mode=` (the FIRE tab links straight into the
          retirement mode), and useSearchParams needs a boundary to prerender. */}
      <Suspense fallback={null}>
        {!enabled ? (
          <FeatureUnavailable />
        ) : locked ? (
          <ProTeaser feature="simulation">
            <MonteCarloPanel />
          </ProTeaser>
        ) : (
          <MonteCarloPanel />
        )}
      </Suspense>
    </div>
  );
}
