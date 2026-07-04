"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import { AllocationView } from "@/components/allocation/allocation-view";
import { ReturnsView } from "@/components/analysis/returns-view";
import { TradesView } from "@/components/analysis/trades-view";
import { RiskView } from "@/components/analysis/risk-view";
import { RiskDisclaimer } from "@/components/ui/risk-disclaimer";
import { useFeatureFlag } from "@/lib/flags/flags-context";

const TABS = ["distributions", "returns", "trades", "risks"] as const;

type TabKey = (typeof TABS)[number];

export default function AnalysisPage() {
  const [tab, setTab] = useState<TabKey>("distributions");
  const { t: tr } = useI18n();

  // The Risk tab is behind a feature flag.
  const riskEnabled = useFeatureFlag("risk");
  const tabs = TABS.filter((key) => key !== "risks" || riskEnabled);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tr("analysis.title")}</h1>
        <p className="text-sm text-zinc-500">{tr(`analysis.blurb.${tab}`)}</p>
      </div>

      <RiskDisclaimer variant="compact" />

      {/* Primary tabs: underline style, visually distinct from the in-card
          breakdown pills. */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="-mb-px flex gap-6">
          {tabs.map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-emerald-500 text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {tr(`analysis.tab.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === "distributions" && <AllocationView />}
      {tab === "returns" && <ReturnsView />}
      {tab === "trades" && <TradesView />}
      {tab === "risks" && riskEnabled && <RiskView />}
    </div>
  );
}
