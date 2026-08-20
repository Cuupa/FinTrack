"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { Timeframe } from "@/lib/finance/dates";
import { NetWorthHero } from "@/components/dashboard/net-worth-hero";
import { LiveShareSync } from "@/components/dashboard/live-share-sync";
import { GuidedTour } from "@/components/onboarding/guided-tour";
import { TourReplayButton } from "@/components/onboarding/page-tours";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { PAGE_STACK, PageHeader } from "@/components/ui/primitives";
import { MonthFlowCard } from "@/components/dashboard/month-flow-card";
import { PlanProgressCard } from "@/components/dashboard/plan-progress-card";
import { KeyInsightsCard } from "@/components/dashboard/key-insights-card";
import { HealthSummaryCard } from "@/components/dashboard/health-summary-card";
import { LoadError } from "@/components/ui/load-error";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function DashboardPage() {
  const { loading, loadError, reload } = usePortfolio();
  const { t } = useI18n();
  // Shared so the holdings table's profit column tracks the hero chart timeframe.
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  // Bumped by the "?" TourReplayButton to force a fresh, open GuidedTour mount.
  const [tourRestart, setTourRestart] = useState(0);

  return (
    <div className={PAGE_STACK}>
      <PageHeader
        title={t("dashboard.title")}
        subtitle={t("dashboard.subtitle")}
        titleAdornment={
          !loading && !loadError ? (
            <TourReplayButton onClick={() => setTourRestart((n) => n + 1)} />
          ) : undefined
        }
      />

      {loading ? (
        <DashboardSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <>
          <LiveShareSync />
          <NetWorthHero timeframe={timeframe} onTimeframe={setTimeframe} />

          {/* "Aktueller Monat" (spec §9 M): the month's movement on the left,
              the standing of the plans on the right -- cashflow and progress,
              side by side. Replaces the old Konten/Ausgaben/Ziele area cards,
              whose figures now live in the KPI strip (Konten), this cashflow
              card (Ausgaben) and the plan-progress card (Ziele). The tour's
              "everyday money" step spotlights this pair. */}
          <div data-tour="areas" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MonthFlowCard />
            <PlanProgressCard />
          </div>

          {/* Wichtige Hinweise (spec §9 I): up to three prioritized findings
              from the user's own figures, each a link to where it is acted on.
              Renders nothing when there is nothing worth surfacing. */}
          <KeyInsightsCard />

          {/* Financial health as a compact, clickable section (spec §9): the
              four gauges no longer earn their own top-level nav page, and the
              savings rate lives here rather than duplicated across KPI rows. */}
          <HealthSummaryCard />

          <GuidedTour restartToken={tourRestart} />
        </>
      )}

    </div>
  );
}
