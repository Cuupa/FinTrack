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
import { AreaCards } from "@/components/dashboard/area-cards";
import { MonthFlowCard } from "@/components/dashboard/month-flow-card";
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

          {/* How the current month is running. What net worth is made of is
              said once, by the composition line inside the hero. */}
          <MonthFlowCard />

          {/* Everyday money before investments. The order is the argument: the
              home screen used to be the holdings table with a net-worth chart
              on top, so accounts and spending were only ever a sidebar click
              away and the product read as a portfolio tracker with extras. */}
          <div data-tour="areas">
            <AreaCards />
          </div>

          <GuidedTour restartToken={tourRestart} />
        </>
      )}

    </div>
  );
}
