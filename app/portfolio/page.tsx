"use client";

// The investments page (owner call): positions, savings plans, watchlist and
// the depot chart, moved off the dashboard.
//
// The home screen used to BE the holdings table with a net-worth chart on top,
// so the product read as a portfolio tracker with a few everyday extras bolted
// on. Net worth is the whole picture — a current account, a mortgage and a
// depot — and the dashboard now shows that, while everything specific to
// securities lives here, in the Investments group of the navigation.
//
// The chart is `investmentsOnly`: on this page the question is how the DEPOT is
// doing, so accounts and liabilities stay out of the line. The dashboard's copy
// of the same component charts everything.

import { useEffect, useRef, useState } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAuth } from "@/lib/auth/auth-context";
import type { Timeframe } from "@/lib/finance/dates";
import { NetWorthHero } from "@/components/dashboard/net-worth-hero";
import { AssetTable } from "@/components/assets/asset-table";
import { AddAssetPanel } from "@/components/assets/add-asset-panel";
import { ExportMenu } from "@/components/dashboard/export-menu";
import { ShareMenu } from "@/components/dashboard/share-menu";
import { WatchlistCard } from "@/components/dashboard/watchlist-card";
import { SavingsPlansCard } from "@/components/dashboard/savings-plans-card";
import { CashInterestDueCard } from "@/components/dashboard/cash-interest-due";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { Button, PAGE_STACK } from "@/components/ui/primitives";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { LoadError } from "@/components/ui/load-error";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { PageScope } from "@/components/page-scope";
import { PORTFOLIO_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

type PortfolioTab = "positions" | "savings" | "watchlist" | "history";

export default function PortfolioPage() {
  const { data, loading, loadError, reload } = usePortfolio();
  const { mode } = useAuth();
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  // Shared so the holdings table's profit column tracks the chart timeframe.
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  // The depot is split into tabs (UX-Unification-Spec §11.1) instead of one
  // long stack: the performance chart and current positions, then savings
  // plans, watchlist and the closed-position history each on their own tab.
  const [tab, setTab] = useState<PortfolioTab>("positions");

  // Loaded, not errored, and actually has holdings: the tour's targets
  // (holdings table, savings plans, watchlist) only render once there is
  // something to hold them, same "content is on screen" gate every page
  // tour follows.
  const ready = !loading && !loadError && data.assets.length > 0;

  const tabItems: TabItem<PortfolioTab>[] = [
    { value: "positions", label: t("portfolio.tab.positions") },
    { value: "savings", label: t("portfolio.tab.savings") },
    { value: "watchlist", label: t("portfolio.tab.watchlist") },
    { value: "history", label: t("portfolio.tab.history") },
  ];

  // A CSV import handed off via `onRun` keeps running after the add-asset
  // modal has already closed — this tracks it for the floating status pill.
  const [importStatus, setImportStatus] = useState<
    { kind: "running" } | { kind: "success" } | { kind: "error"; message: string } | null
  >(null);
  const importHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (importHideTimer.current) clearTimeout(importHideTimer.current);
    };
  }, []);

  function handleImportRun(job: Promise<void>) {
    if (importHideTimer.current) {
      clearTimeout(importHideTimer.current);
      importHideTimer.current = null;
    }
    setImportStatus({ kind: "running" });
    job.then(
      () => {
        setImportStatus({ kind: "success" });
        importHideTimer.current = setTimeout(() => setImportStatus(null), 4000);
      },
      (e: unknown) => {
        setImportStatus({
          kind: "error",
          message: isStorageFullError(e)
            ? t("common.storageFull")
            : e instanceof Error
              ? e.message
              : t("import.applyError"),
        });
      },
    );
  }

  return (
    <div className={PAGE_STACK}>
      <PageHeaderWithTour
        title={t("portfolio.title")}
        subtitle={t("portfolio.subtitle")}
        tourId="portfolio"
        steps={PORTFOLIO_TOUR_STEPS}
        ready={ready}
        scope={<PageScope />}
        actions={
          <>
            <ShareMenu />
            {/* Registered users export from the profile menu; guests (no profile
                menu) keep the standalone export button here. */}
            {mode !== "registered" && <ExportMenu />}
            {!adding && (
              <Button
                variant="primary"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                data-tour="add-asset"
                onClick={() => setAdding(true)}
              >
                {t("dashboard.addAsset")}
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <DashboardSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : (
        <>
          <Tabs items={tabItems} value={tab} onChange={setTab} />
          {tab === "positions" && (
            <>
              <NetWorthHero timeframe={timeframe} onTimeframe={setTimeframe} investmentsOnly />
              <AssetTable timeframe={timeframe} view="current" />
              {/* The nav's Depot count includes cash interest, so the task has
                  to be reachable from here and not only from the asset page. */}
              <CashInterestDueCard />
            </>
          )}
          {tab === "savings" && <SavingsPlansCard />}
          {tab === "watchlist" && <WatchlistCard />}
          {tab === "history" && <AssetTable timeframe={timeframe} view="past" />}
        </>
      )}

      {/* Add-asset opens in a modal so it appears right where you clicked, not
          buried at the bottom of the page. Window-wide (capped at the site's
          1600px content width) so the CSV merge view has room. */}
      <Modal open={adding} onClose={() => setAdding(false)} maxWidthClass="max-w-[1600px]">
        <AddAssetPanel onDone={() => setAdding(false)} onRun={handleImportRun} />
      </Modal>

      {importStatus && (
        <div className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg md:bottom-6 dark:border-zinc-800 dark:bg-zinc-900">
          {importStatus.kind === "running" && (
            <>
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
              <span>{t("import.importing")}</span>
            </>
          )}
          {importStatus.kind === "success" && (
            <span className="text-emerald-600 dark:text-emerald-400">{t("import.finished")}</span>
          )}
          {importStatus.kind === "error" && (
            <>
              <span className="text-red-600 dark:text-red-400">{importStatus.message}</span>
              <button
                type="button"
                onClick={() => setImportStatus(null)}
                aria-label={t("common.close")}
                className="shrink-0 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
