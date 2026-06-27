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
  transactionsByAsset,
} from "@/lib/finance/portfolio";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { useDividends } from "@/lib/history/use-dividends";
import { netFlows, cumulativeReturnSeries, riskMetrics } from "@/lib/finance/returns";
import { InfoTip } from "@/components/ui/info-tip";
import { portfolioIRR } from "@/lib/finance/irr";
import { assetPriceKey } from "@/lib/types";
import { formatCurrency, formatPercent, plColor } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { ChartControls } from "@/components/charts/chart-controls";
import { BenchmarkPicker } from "@/components/charts/benchmark-picker";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
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
  const [benchmarks, setBenchmarks] = useState<string[]>([]);

  const currency = data.profile.currency;
  const compare = useBenchmarkCompare(benchmarks, currency);
  const toggleBenchmark = (id: string) =>
    setBenchmarks((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));

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
  // Contribution-adjusted cumulative return over the window, for "Return" mode.
  const returnSeries = useMemo(
    () => cumulativeReturnSeries(series, netFlows(data.assets, data.transactions, valuation)),
    [series, data.assets, data.transactions, valuation],
  );
  // Risk metrics over the selected window (TWR, vol, drawdown, downside vol).
  const risk = useMemo(() => riskMetrics(returnSeries), [returnSeries]);

  const totals = useMemo(
    () => portfolioTotals(summarizeAll(data.assets, data.transactions, valuation)),
    [data.assets, data.transactions, valuation],
  );

  // Money-weighted return (IRR / interner Zinsfuß) across all cash flows.
  const irr = useMemo(() => {
    const flows = netFlows(data.assets, data.transactions, valuation).map((f) => ({
      date: f.date,
      amount: -f.amount, // investor view: buys out (−), sells in (+)
    }));
    return portfolioIRR(flows, totals.marketValue);
  }, [data.assets, data.transactions, valuation, totals.marketValue]);

  // Real dividends received across all holdings, converted to the base currency.
  const divMap = useDividends(histItems);
  const dividendsReceived = useMemo(() => {
    const fx = valuation.fx ?? {};
    let total = 0;
    for (const asset of data.assets) {
      const events = divMap[assetPriceKey(asset)];
      if (!events || events.length === 0) continue;
      const txs = transactionsByAsset(asset.id, data.transactions);
      const received = totalDividends(dividendsFromEvents(events, txs)); // asset currency
      const cur = asset.currency ?? currency;
      total += received * (cur === currency ? 1 : (fx[cur] ?? 1));
    }
    return total;
  }, [divMap, data.assets, data.transactions, currency, valuation]);

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
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Net worth"
            value={formatCurrency(totals.marketValue, currency)}
            info="Total current value of all your holdings, converted to your base currency."
            isPrivate
          />
          <Stat
            label={`Change (${timeframe})`}
            value={formatCurrency(periodChange.abs, currency)}
            sub={formatPercent(periodChange.pct)}
            valueClassName={plColor(periodChange.abs)}
            info="How much your net worth moved over the selected timeframe ."
            isPrivate
          />
          <Stat
            label="Unrealized P&L"
            value={formatCurrency(totals.unrealizedPL, currency)}
            sub={formatPercent(totals.totalPLPercent)}
            valueClassName={plColor(totals.unrealizedPL)}
            info="Paper gain/loss on shares you still hold."
            isPrivate
          />
          <Stat
            label="Realized P&L"
            value={formatCurrency(totals.realizedPL, currency)}
            valueClassName={plColor(totals.realizedPL)}
            info="Locked-in gain/loss from shares you have sold."
            isPrivate
          />
          <Stat
            label="Dividends received"
            value={formatCurrency(dividendsReceived, currency)}
            valueClassName={dividendsReceived > 0 ? plColor(1) : ""}
            info="Sum of actual dividend payouts received, scaled by the shares held on each pay date."
            isPrivate
          />
          <Stat
            label="IRR (p.a.)"
            value={irr != null ? formatPercent(irr) : "—"}
            valueClassName={irr != null ? plColor(irr) : ""}
            info="Annualised, money-weighted return that accounts for the timing and size of every buy and sell."
          />
          <Stat
            label={`TWR (${timeframe})`}
            value={formatPercent(risk.twr)}
            valueClassName={plColor(risk.twr)}
            info="True time-weighted return over the selected timeframe: the portfolio's compounded performance with deposits/withdrawals removed (comparable to a fund/benchmark)."
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
      <div className="mt-3 flex justify-end">
        <BenchmarkPicker selected={benchmarks} onToggle={toggleBenchmark} />
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
            compare={compare}
            mainLabel="Net worth"
            returnSeries={returnSeries}
          />
        )}
      </div>

      {data.assets.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-4 dark:border-zinc-800">
          <RiskStat
            label="Volatility"
            value={formatPercent(risk.volatility)}
            info={`Annualised standard deviation of the portfolio's daily returns over ${timeframe}.`}
          />
          <RiskStat
            label="Max drawdown"
            value={formatPercent(-risk.maxDrawdown)}
            valueClassName={risk.maxDrawdown > 0 ? plColor(-1) : ""}
            info="Largest peak-to-trough decline over the timeframe."
          />
          <RiskStat
            label="Drawdown duration"
            value={`${risk.maxDrawdownDays} d`}
            info="Longest stretch the portfolio spent below a previous peak."
          />
          <RiskStat
            label="Downside vol"
            value={formatPercent(risk.downsideDeviation)}
            info="Annualised semi-deviation — volatility of only the negative days (downside risk)."
          />
        </div>
      )}
    </Card>
  );
}

function RiskStat({
  label,
  value,
  info,
  valueClassName = "",
}: {
  label: string;
  value: string;
  info: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        {label}
        <InfoTip text={info} />
      </div>
      <div className={`mt-0.5 font-semibold tabular-nums ${valueClassName}`}>{value}</div>
    </div>
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
