"use client";

// Global dashboard hero (PRD §4.1): net-worth-over-time chart with timeframe,
// scale and display-mode controls, plus headline portfolio stats.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import type { Timeframe } from "@/lib/finance/dates";
import {
  netWorthSeries,
  portfolioTotals,
  summarizeAll,
} from "@/lib/finance/portfolio";
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { ChartControls } from "@/components/charts/chart-controls";
import {
  PerformanceChart,
  type ChartMode,
  type ChartScale,
} from "@/components/charts/performance-chart";

export function NetWorthHero() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [mode, setMode] = useState<ChartMode>("currency");

  const currency = data.profile.currency;

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories } = useHistory(histItems, timeframe, currency);

  const series = useMemo(
    () => netWorthSeries(data.assets, data.transactions, timeframe, valuation, histories),
    [data.assets, data.transactions, timeframe, valuation, histories],
  );

  const totals = useMemo(
    () => portfolioTotals(summarizeAll(data.assets, data.transactions, valuation)),
    [data.assets, data.transactions, valuation],
  );

  // Period change derived from the visible series.
  const periodChange = useMemo(() => {
    const start = series.find((p) => p.value > 0)?.value ?? 0;
    const end = series[series.length - 1]?.value ?? 0;
    const abs = end - start;
    const pct = start > 0 ? abs / start : 0;
    return { abs, pct };
  }, [series]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
          <Stat label="Net worth" value={formatCurrency(totals.marketValue, currency)} />
          <Stat
            label={`Change (${timeframe})`}
            value={formatCurrency(periodChange.abs, currency)}
            sub={formatPercent(periodChange.pct)}
            valueClassName={plColor(periodChange.abs)}
          />
          <Stat
            label="Unrealized P&L"
            value={formatCurrency(totals.unrealizedPL, currency)}
            sub={formatPercent(totals.totalPLPercent)}
            valueClassName={plColor(totals.unrealizedPL)}
          />
          <Stat
            label="Realized P&L"
            value={formatCurrency(totals.realizedPL, currency)}
            valueClassName={plColor(totals.realizedPL)}
          />
        </div>
      </div>

      <div className="mt-6">
        <ChartControls
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          scale={scale}
          onScale={setScale}
          mode={mode}
          onMode={setMode}
        />
      </div>

      <div className="mt-4">
        {totals.marketValue === 0 && data.assets.length === 0 ? (
          <EmptyChart />
        ) : (
          <PerformanceChart
            series={series}
            scale={scale}
            mode={mode}
            currency={currency}
          />
        )}
      </div>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 text-center text-zinc-500 dark:border-zinc-700">
      <p className="font-medium">No holdings yet</p>
      <p className="text-sm">Add your first asset below to see your net worth grow.</p>
    </div>
  );
}
