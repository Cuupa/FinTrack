"use client";

import { useState } from "react";
import { AllocationView } from "@/components/allocation/allocation-view";
import { ReturnsView } from "@/components/analysis/returns-view";
import { TradesView } from "@/components/analysis/trades-view";

const TABS = [
  { key: "distributions", label: "Distributions" },
  { key: "returns", label: "Returns" },
  { key: "trades", label: "Trades" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const BLURB: Record<TabKey, string> = {
  distributions: "How your portfolio is split across investments, classes, sectors, regions and risk.",
  returns: "Your contribution-adjusted returns by quarter and year, and a per-holding performance map.",
  trades: "Realized P&L over time and your best and worst positions.",
};

export default function AnalysisPage() {
  const [tab, setTab] = useState<TabKey>("distributions");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
        <p className="text-sm text-zinc-500">{BLURB[tab]}</p>
      </div>

      {/* Primary tabs: underline style, visually distinct from the in-card
          breakdown pills. */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="-mb-px flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-emerald-500 text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "distributions" && <AllocationView />}
      {tab === "returns" && <ReturnsView />}
      {tab === "trades" && <TradesView />}
    </div>
  );
}
