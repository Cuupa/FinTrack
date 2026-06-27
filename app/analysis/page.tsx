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

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "distributions" && <AllocationView />}
      {tab === "returns" && <ReturnsView />}
      {tab === "trades" && <TradesView />}
    </div>
  );
}
