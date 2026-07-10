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
  twrSeries,
} from "@/lib/finance/portfolio";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { useDividends } from "@/lib/history/use-dividends";
import { netFlows, riskMetrics } from "@/lib/finance/returns";
import { InfoTip } from "@/components/ui/info-tip";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { portfolioIRR } from "@/lib/finance/irr";
import { assetPriceKey } from "@/lib/types";
import { formatCurrency, formatDate, formatPercent, plColor } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";
import { usePrivacy } from "@/lib/privacy/privacy-context";
import { ChartControls } from "@/components/charts/chart-controls";
import { BenchmarkPicker } from "@/components/charts/benchmark-picker";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import {
  PerformanceChart,
  type ChartMode,
  type ChartScale,
} from "@/components/charts/performance-chart";

export function NetWorthHero({
  timeframe,
  onTimeframe,
}: {
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
}) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const { incognito } = usePrivacy();
  const setTimeframe = onTimeframe;
  const [scale, setScale] = useState<ChartScale>("linear");
  const [mode, setMode] = useState<ChartMode>("currency");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);

  const currency = data.profile.currency;
  const comparing = benchmarks.length > 0;
  // Privacy mode hides absolute wealth → the chart is always Return there.
  const chartMode: ChartMode = comparing || incognito ? "percent" : mode;
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
  const { histories, loading: historyLoading } = useHistory(histItems, timeframe, currency);

  const { points: series, containsSynthetic } = useMemo(
    () => netWorthSeries(data.assets, data.transactions, timeframe, valuation, histories),
    [data.assets, data.transactions, timeframe, valuation, histories],
  );
  // True time-weighted cumulative return (price-based, deposits never counted),
  // for "Return" mode — what brokers plot as TWROR.
  const returnSeries = useMemo(
    () => twrSeries(data.assets, data.transactions, timeframe, valuation, histories),
    [data.assets, data.transactions, timeframe, valuation, histories],
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

  // Period change: absolute net-worth delta over the window, and the return
  // relative to the window's starting value (with deposits/withdrawals removed,
  // so the % is consistent with the absolute change). Falls back to TWR only
  // when the starting value is negligible (early portfolio), where the raw ratio
  // would blow up.
  const periodChange = useMemo(() => {
    const start = series.find((p) => p.value > 0)?.value ?? 0;
    const end = series[series.length - 1]?.value ?? 0;
    const abs = end - start;
    const winStart = series[0]?.date ?? "";
    const flowsIn = netFlows(data.assets, data.transactions, valuation)
      .filter((f) => f.date >= winStart)
      .reduce((s, f) => s + f.amount, 0);
    const peak = series.reduce((m, p) => (p.value > m ? p.value : m), 0);
    const pct = start > peak * 0.02 ? (end - start - flowsIn) / start : risk.twr;
    return { abs, pct };
  }, [series, data.assets, data.transactions, valuation, risk.twr]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-3 lg:grid-cols-6">
          <Stat
            label={t("stat.netWorth")}
            value={formatCurrency(totals.marketValue, currency)}
            info={t("tip.netWorth")}
            isPrivate
            size="sm"
          />
          <Stat
            label={`${t("stat.change")} (${timeframe})`}
            value={historyLoading ? "…" : formatCurrency(periodChange.abs, currency)}
            sub={historyLoading ? undefined : formatPercent(periodChange.pct)}
            valueClassName={historyLoading ? "text-zinc-400" : plColor(periodChange.abs)}
            info={t("tip.change")}
            isPrivate
            size="sm"
          />
          <Stat
            label={t("stat.unrealized")}
            value={formatCurrency(totals.unrealizedPL, currency)}
            sub={formatPercent(totals.totalPLPercent)}
            valueClassName={plColor(totals.unrealizedPL)}
            info={t("tip.unrealized")}
            isPrivate
            size="sm"
          />
          <Stat
            label={t("stat.realized")}
            value={formatCurrency(totals.realizedPL, currency)}
            valueClassName={plColor(totals.realizedPL)}
            info={t("tip.realized")}
            isPrivate
            size="sm"
          />
          <Stat
            label={t("stat.dividends")}
            value={formatCurrency(dividendsReceived, currency)}
            valueClassName={dividendsReceived > 0 ? plColor(1) : ""}
            info={t("tip.dividends")}
            isPrivate
            size="sm"
          />
          <Stat
            label={t("stat.irr")}
            value={irr != null ? formatPercent(irr) : "—"}
            valueClassName={irr != null ? plColor(irr) : ""}
            info={t("tip.irr")}
            size="sm"
          />
        </div>
      </div>

      <div className="mt-3 md:mt-4">
        <ChartControls
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          scale={scale}
          onScale={setScale}
          // Comparing forces relative (Return) mode — reflect that in the toggle.
          // Privacy mode forbids Wealth entirely, so hide the toggle there.
          mode={chartMode}
          onMode={setMode}
          showMode={!incognito}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 md:mt-3">
        <span className="shrink-0">
          {!historyLoading && containsSynthetic && (
            <EstimatedBadge tip={t("data.estimatedChartTip")} />
          )}
        </span>
        <div className="min-w-0">
          <BenchmarkPicker selected={benchmarks} onToggle={toggleBenchmark} />
        </div>
      </div>

      <div className="mt-3 md:mt-4">
        {totals.marketValue === 0 && data.assets.length === 0 ? (
          <EmptyChart />
        ) : historyLoading ? (
          <LoadingChart />
        ) : (
          <PerformanceChart
            series={series}
            scale={scale}
            mode={chartMode}
            currency={currency}
            compare={compare}
            mainLabel="Net worth"
            returnSeries={returnSeries}
            ariaLabel={t("chart.netWorth.ariaLabel", {
              timeframe,
              start: series[0] ? formatDate(series[0].date) : "",
              end: series.length ? formatDate(series[series.length - 1].date) : "",
              change: formatCurrency(periodChange.abs, currency),
              pct: formatPercent(periodChange.pct),
            })}
          />
        )}
      </div>

      {data.assets.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-5 dark:border-zinc-800">
          <RiskStat
            label={`${t("stat.twr")} (${timeframe})`}
            value={historyLoading ? "…" : formatPercent(risk.twr)}
            valueClassName={historyLoading ? "" : plColor(risk.twr)}
            info={t("tip.twr")}
          />
          <RiskStat
            label={t("stat.volatility")}
            value={historyLoading ? "…" : formatPercent(risk.volatility)}
            info={t("tip.volatility")}
          />
          <RiskStat
            label={t("stat.maxDrawdown")}
            value={historyLoading ? "…" : formatPercent(-risk.maxDrawdown)}
            valueClassName={!historyLoading && risk.maxDrawdown > 0 ? plColor(-1) : ""}
            info={t("tip.maxDrawdown")}
          />
          <RiskStat
            label={t("stat.drawdownDuration")}
            value={historyLoading ? "…" : `${risk.maxDrawdownDays} d`}
            info={t("tip.drawdownDuration")}
          />
          <RiskStat
            label={t("stat.downsideVol")}
            value={historyLoading ? "…" : formatPercent(risk.downsideDeviation)}
            info={t("tip.downsideVol")}
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
      <div className="flex min-h-[2rem] items-start text-xs leading-snug text-zinc-500">
        <span>
          {label}
          <span className="ml-1 inline-flex translate-y-0.5 align-text-bottom">
            <InfoTip text={info} />
          </span>
        </span>
      </div>
      <div className={`mt-0.5 font-semibold tabular-nums ${valueClassName}`}>{value}</div>
    </div>
  );
}

function LoadingChart() {
  const { t } = useI18n();
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-200 text-center text-zinc-400 dark:border-zinc-800">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
      <p className="text-sm">{t("chart.loading")}</p>
    </div>
  );
}

function EmptyChart() {
  const { t } = useI18n();
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 text-center text-zinc-500 dark:border-zinc-700">
      <p className="font-medium">{t("empty.noHoldings")}</p>
      <p className="text-sm">{t("empty.addFirst")}</p>
    </div>
  );
}
