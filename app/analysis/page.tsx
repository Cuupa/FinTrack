"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";
import { AllocationView } from "@/components/allocation/allocation-view";
import { ReturnsView } from "@/components/analysis/returns-view";
import { TradesView } from "@/components/analysis/trades-view";
import { RiskView } from "@/components/analysis/risk-view";
import { TaxView } from "@/components/analysis/tax-view";
import { RiskDisclaimer } from "@/components/ui/risk-disclaimer";
import { useFeatureFlag } from "@/lib/flags/flags-context";

const TABS = ["distributions", "returns", "trades", "risks", "tax"] as const;

type TabKey = (typeof TABS)[number];

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TABS as readonly string[]).includes(value);
}

export default function AnalysisPage() {
  // useSearchParams requires a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <AnalysisPageInner />
    </Suspense>
  );
}

function AnalysisPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t: tr } = useI18n();

  // The Risk and Tax tabs are behind feature flags.
  const riskEnabled = useFeatureFlag("risk");
  const taxReportEnabled = useFeatureFlag("taxReport");
  const tabs = TABS.filter((key) => key !== "risks" || riskEnabled).filter(
    (key) => key !== "tax" || taxReportEnabled,
  );

  // The URL is a mirror of the client state, not the other way round: the
  // initial tab is read once from `?tab=`, invalid or flag-hidden values fall
  // back to "distributions". Later changes flow state -> URL (via
  // router.replace below), never URL -> state, so there's no sync loop.
  const requestedTab = searchParams.get("tab");
  const initialTab: TabKey =
    isTabKey(requestedTab) && tabs.includes(requestedTab) ? requestedTab : "distributions";
  const [tab, setTab] = useState<TabKey>(initialTab);

  const selectTab = (key: TabKey) => {
    setTab(key);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

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
              onClick={() => selectTab(key)}
              aria-pressed={tab === key}
              className={`border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-emerald-500 text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {tr(key === "tax" ? "tax.tabLabel" : `analysis.tab.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === "distributions" && <AllocationView />}
      {tab === "returns" && <ReturnsView />}
      {tab === "trades" && <TradesView />}
      {tab === "risks" && riskEnabled && <RiskView />}
      {tab === "tax" && taxReportEnabled && <TaxView />}
    </div>
  );
}
