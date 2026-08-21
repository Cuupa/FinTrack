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
  netWorthBreakdownSeries,
  netWorthSeries,
  nonCashAssets,
  portfolioTotals,
  summarizeAll,
  transactionsByAsset,
  twrSeries,
} from "@/lib/finance/portfolio";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { accountsTotals, accountsValueOn } from "@/lib/finance/accounts";
import { computeFinancialHealth, liquidBalance } from "@/lib/finance/health";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { today } from "@/lib/finance/dates";
import { useDividends } from "@/lib/history/use-dividends";
import { changeContributions, netFlows, riskMetrics, windowChange } from "@/lib/finance/returns";
import { InfoTip } from "@/components/ui/info-tip";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { portfolioIRR } from "@/lib/finance/irr";
import { assetPriceKey } from "@/lib/types";
import { formatCurrency, formatDate, formatNumber, formatPercent, plColor } from "@/lib/format";
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
import { NetWorthBreakdownChart } from "@/components/charts/net-worth-breakdown-chart";
import { BENCHMARKS, buildCustomBenchmark, type Benchmark } from "@/lib/finance/benchmarks";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";

export function NetWorthHero({
  timeframe,
  onTimeframe,
  investmentsOnly = false,
}: {
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  /**
   * Chart the DEPOT alone instead of total net worth. Set on /portfolio, where
   * the question is "how are my investments doing" -- folding the current
   * account and the mortgage into that line would answer a different one. The
   * dashboard leaves it off and charts everything.
   */
  investmentsOnly?: boolean;
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
  const [customBenchmarks, setCustomBenchmarks] = useState<Benchmark[]>([]);

  const currency = data.profile.currency;
  // Balance accounts & liabilities (ROADMAP #1) fold into net worth only when
  // the flag is on; off, the arrays are undefined and net worth is unchanged.
  const accountsEnabled = useFeatureFlag("accounts") && !investmentsOnly;
  const accounts = accountsEnabled ? data.accounts : undefined;
  const accountBalances = accountsEnabled ? data.accountBalances : undefined;
  const comparing = benchmarks.length > 0;
  // Privacy mode hides absolute wealth → the chart is always Return there.
  const chartMode: ChartMode = comparing || incognito ? "percent" : mode;
  const compare = useBenchmarkCompare(benchmarks, currency, customBenchmarks);
  const toggleBenchmark = (id: string) =>
    setBenchmarks((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));
  const addCustomBenchmark = async (query: string) => {
    const master = await resolveInstrumentByQuery(query);
    if (!master) return { ok: false, error: t("benchmark.notFound") };
    const b = buildCustomBenchmark(master, [...BENCHMARKS, ...customBenchmarks]);
    if (!b) return { ok: false, error: t("benchmark.alreadyAdded") };
    setCustomBenchmarks((c) => [...c, b]);
    setBenchmarks((sel) => (sel.includes(b.id) ? sel : [...sel, b.id]));
    return { ok: true };
  };
  const removeCustomBenchmark = (id: string) => {
    setCustomBenchmarks((c) => c.filter((b) => b.id !== id));
    setBenchmarks((sel) => sel.filter((x) => x !== id));
  };

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories, fx, loading: historyLoading } = useHistory(histItems, timeframe, currency);

  // Layers the fetched historical FX series onto the live valuation so
  // netWorthSeries/twrSeries convert each historical point at the FX rate of
  // ITS OWN date instead of today's spot rate (rateOn in portfolio.ts).
  // Referentially equal to `valuation` when there's no fx yet, so nothing
  // downstream re-renders differently than before.
  const effectiveValuation = useMemo(() => {
    if (!fx || Object.keys(fx).length === 0) return valuation;
    return { ...valuation, fxHistory: fx };
  }, [valuation, fx]);

  // Bookings move balances (lib/finance/account-ledger.ts): the chart carries
  // each account forward from its last reading instead of holding it flat.
  const movements = useAccountMovements();

  const { points: series, containsSynthetic } = useMemo(
    () =>
      netWorthSeries(
        nonCashAssets(data.assets),
        data.transactions,
        timeframe,
        effectiveValuation,
        histories,
        accounts,
        accountBalances,
        movements,
      ),
    [
      data.assets,
      data.transactions,
      timeframe,
      effectiveValuation,
      histories,
      accounts,
      accountBalances,
      movements,
    ],
  );
  // The overview charts net worth split into the two sides it is made of
  // (spec §9): everything owned against everything owed, plus the net line. Its
  // net equals `series` exactly (same replay, same dates), so the two never
  // disagree. Only built for the dashboard -- the depot chart is a single line.
  const breakdown = useMemo(
    () =>
      investmentsOnly
        ? null
        : netWorthBreakdownSeries(
            nonCashAssets(data.assets),
            data.transactions,
            timeframe,
            effectiveValuation,
            histories,
            accounts,
            accountBalances,
            movements,
          ),
    [
      investmentsOnly,
      data.assets,
      data.transactions,
      timeframe,
      effectiveValuation,
      histories,
      accounts,
      accountBalances,
      movements,
    ],
  );
  // The breakdown replaces the plain net line only in currency mode. Privacy
  // mode forces percent (wealth hidden), where the Return line and its scope
  // note stand instead, so the single-line PerformanceChart still renders there.
  const showBreakdown = !investmentsOnly && chartMode === "currency" && breakdown != null;

  // True time-weighted cumulative return (price-based, deposits never counted),
  // for "Return" mode — what brokers plot as TWROR.
  const returnSeries = useMemo(
    () => twrSeries(nonCashAssets(data.assets), data.transactions, timeframe, effectiveValuation, histories),
    [data.assets, data.transactions, timeframe, effectiveValuation, histories],
  );
  // Risk metrics over the selected window (TWR, vol, drawdown, downside vol).
  const risk = useMemo(() => riskMetrics(returnSeries), [returnSeries]);

  const totals = useMemo(
    () => portfolioTotals(summarizeAll(data.assets, data.transactions, valuation)),
    [data.assets, data.transactions, valuation],
  );

  // Net worth includes balance accounts & liabilities (ROADMAP #1): holdings
  // market value plus the signed sum of every account, in the base currency.
  const accountsNet = useMemo(
    () =>
      accounts ? accountsValueOn(accounts, accountBalances ?? [], today(), valuation, movements) : 0,
    [accounts, accountBalances, valuation, movements],
  );
  const netWorth = totals.marketValue + accountsNet;

  // On /portfolio the same figure is the DEPOT's value, not net worth: no
  // account and no liability is in it (`investmentsOnly` keeps them out of the
  // series above), so calling it net worth would name it after a number it
  // deliberately does not include.
  const headlineLabel = investmentsOnly ? t("stat.depotValue") : t("stat.netWorth");
  const headlineInfo = investmentsOnly ? t("tip.depotValue") : t("tip.netWorth");

  // Return mode plots `returnSeries`, and that is the DEPOT's time-weighted
  // return -- an account balance is a figure the user sets and a debt is owed,
  // so neither has a price series to compound. On the dashboard the currency
  // line is net worth and the Return line is not, so the line is named after
  // what it actually plots; the note says it once for the risk figures below,
  // which come from that same series. Benchmarks force percent mode, so a
  // comparison is covered by the same rule.
  const returnScoped = !investmentsOnly && chartMode === "percent";
  // The overview chart carries no return metrics (spec §9/§17: no index
  // comparison, no Rendite figures on net worth), so the scope note only
  // applies when a Return line is actually on screen -- which on the dashboard
  // only happens in privacy mode, where wealth is hidden and the chart is
  // forced to percent.
  const showScopeNote =
    !investmentsOnly && (accounts?.length ?? 0) > 0 && chartMode === "percent";

  // Split of that same number, so the headline can show what it is made of
  // rather than presenting a portfolio figure with accounts silently folded in.
  const acctSplit = useMemo(
    () =>
      accounts
        ? accountsTotals(accounts, accountBalances ?? [], valuation, movements)
        : { assets: 0, liabilities: 0, net: 0 },
    [accounts, accountBalances, valuation, movements],
  );

  // Cash you can spend now: liquid (checking/savings) account balances only,
  // not property or other manual-valuation accounts. Feeds the overview's
  // "Liquid verfügbar" status figure (spec §9).
  const liquid = useMemo(
    () =>
      accounts
        ? liquidBalance(accounts, accountBalances ?? [], { base: currency, fx: valuation.fx }, movements)
        : 0,
    [accounts, accountBalances, currency, valuation.fx, movements],
  );

  // The overview is not a depot report: four of its six figures used to be
  // securities-only (unrealised, realised, dividends, IRR) on a page that also
  // answers for accounts, debt and spending. Two of them give way here to the
  // everyday-money pair, reusing /health's own gauges rather than deriving a
  // second savings rate — same numbers, same words, computed once.
  // `/portfolio` keeps the depot set: there the figures ARE the subject.
  const healthEnabled = useFeatureFlag("finHealth");
  const health = useMemo(
    () =>
      investmentsOnly || !healthEnabled
        ? null
        : computeFinancialHealth(
            accounts ?? [],
            accountBalances ?? [],
            data.spendingTransactions,
            netWorth,
            today(),
            { base: currency, fx: valuation.fx },
          ),
    [
      investmentsOnly,
      healthEnabled,
      accounts,
      accountBalances,
      data.spendingTransactions,
      netWorth,
      currency,
      valuation.fx,
    ],
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
  const { dividends: divMap } = useDividends(histItems);
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
  const periodChange = useMemo(
    () => windowChange(series, netFlows(data.assets, data.transactions, valuation), risk.twr),
    [series, data.assets, data.transactions, valuation, risk.twr],
  );

  // "Wie setzt sich die Veränderung zusammen?" -- the same three bands the
  // composition bar splits net worth into, but as each band's CONTRIBUTION to
  // the change over the window (a debt paid down is a positive contribution).
  // The three add up to `periodChange.abs` exactly (investments is the residual,
  // so any rounding in the account totals lands there, not in a broken sum).
  // Only meaningful once accounts fold in; on /portfolio the plain tip stays.
  const changeInfo = useMemo(() => {
    if (investmentsOnly || !accounts || accounts.length === 0) return t("tip.change");
    const startPoint = series.find((p) => p.value !== 0);
    if (!startPoint) return t("tip.change");
    const start = accountsTotals(accounts, accountBalances ?? [], valuation, movements, startPoint.date);
    const split = changeContributions(periodChange.abs, start, acctSplit);
    const contributions = [
      { label: t("nav.group.invest"), v: split.investments },
      { label: t("nav.accounts"), v: split.accounts },
      { label: t("nav.debt"), v: split.liabilities },
    ].filter((c) => Math.round(c.v) !== 0);
    if (contributions.length < 2) return t("tip.change");
    const signed = (v: number) => (v >= 0 ? "+" : "") + formatCurrency(v, currency);
    const parts = contributions.map((c) => `• ${c.label} ${signed(c.v)}`).join("\n");
    return t("tip.changeBreakdown", { parts });
  }, [
    investmentsOnly,
    accounts,
    accountBalances,
    valuation,
    movements,
    series,
    acctSplit,
    periodChange.abs,
    currency,
    t,
  ]);

  return (
    <Card data-tour="net-worth">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {investmentsOnly ? (
          // Depot readout: the figures ARE the subject here, so the return
          // metrics (P&L, dividends, IRR) belong.
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 md:gap-x-8 md:gap-y-3 lg:grid-cols-6">
            <Stat
              label={headlineLabel}
              value={formatCurrency(netWorth, currency)}
              info={headlineInfo}
              isPrivate
              size="sm"
            />
            <Stat
              label={`${t("stat.change")} (${timeframe})`}
              value={historyLoading ? "…" : formatCurrency(periodChange.abs, currency)}
              sub={historyLoading ? undefined : formatPercent(periodChange.pct)}
              valueClassName={historyLoading ? "text-zinc-400" : plColor(periodChange.abs)}
              info={changeInfo}
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
        ) : (
          // Financial STATUS, not depot performance (spec §9): what you are
          // worth, how the month moved it, what is liquid, what is invested and
          // what you owe. The change is the only figure that carries semantic
          // colour (§6.2) -- the stock values stay neutral. Return metrics
          // (dividends, IRR, realised/unrealised, savings rate) live on
          // /portfolio and in the health section, not on the overview.
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:gap-x-8 lg:grid-cols-5">
            <Stat
              label={t("stat.netWorth")}
              value={formatCurrency(netWorth, currency)}
              info={t("tip.netWorth")}
              isPrivate
              size="sm"
            />
            <Stat
              label={`${t("stat.change")} (${timeframe})`}
              value={historyLoading ? "…" : formatCurrency(periodChange.abs, currency)}
              sub={historyLoading ? undefined : formatPercent(periodChange.pct)}
              valueClassName={historyLoading ? "text-zinc-400" : plColor(periodChange.abs)}
              info={changeInfo}
              isPrivate
              size="sm"
            />
            <Stat
              label={t("overview.status.liquid")}
              value={formatCurrency(liquid, currency)}
              sub={
                health?.monthsOfExpensesCovered != null
                  ? `${formatNumber(health.monthsOfExpensesCovered, 1)} ${t("health.unit.months")}`
                  : undefined
              }
              info={t("overview.status.liquidTip")}
              isPrivate
              size="sm"
            />
            <Stat
              label={t("overview.status.invested")}
              value={formatCurrency(totals.marketValue, currency)}
              sub={formatPercent(totals.totalPLPercent)}
              info={t("overview.status.investedTip")}
              isPrivate
              size="sm"
            />
            <Stat
              label={t("nav.debt")}
              value={formatCurrency(Math.abs(acctSplit.liabilities), currency)}
              info={t("overview.status.liabilitiesTip")}
              isPrivate
              size="sm"
            />
          </div>
        )}
      </div>

      {/* No composition bar: the Finanzstatus strip above already states
          invested, liquid and liabilities as figures, and the spec forbids
          saying the same thing twice on the overview (§9). */}

      <div className="mt-3 md:mt-4">
        <ChartControls
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          scale={scale}
          onScale={setScale}
          // Comparing forces relative (Return) mode — reflect that in the toggle.
          // Privacy mode forbids Wealth entirely, so hide the toggle there.
          // The overview is net worth over time, not a return view, so the
          // Wealth/Return toggle only belongs on the depot chart (spec §9/§17).
          mode={chartMode}
          onMode={setMode}
          showMode={!incognito && investmentsOnly}
          // The overview's assets/liabilities/net view is a comparison of
          // magnitudes that crosses zero (a mortgage), where a log axis is
          // undefined; the depot's single positive line keeps its log toggle.
          scaleAvailable={investmentsOnly}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 md:mt-3">
        <span className="shrink-0">
          {!historyLoading && containsSynthetic && (
            <EstimatedBadge tip={t("data.estimatedChartTip")} />
          )}
        </span>
        {/* Benchmarks compare the DEPOT against indices. Net worth carries a
            mortgage and cash, so an index line on it compares unlike things --
            offered on /portfolio only (spec §9/§17). */}
        {investmentsOnly && (
          <div className="min-w-0">
            <BenchmarkPicker
              selected={benchmarks}
              onToggle={toggleBenchmark}
              custom={customBenchmarks}
              onAddCustom={addCustomBenchmark}
              onRemoveCustom={removeCustomBenchmark}
            />
          </div>
        )}
      </div>

      <div className="mt-3 md:mt-4">
        {totals.marketValue === 0 && data.assets.length === 0 && !accounts?.length ? (
          <EmptyChart />
        ) : historyLoading ? (
          <LoadingChart />
        ) : showBreakdown && breakdown ? (
          <NetWorthBreakdownChart
            points={breakdown.points}
            currency={currency}
            labels={{
              net: t("stat.netWorth"),
              assets: t("overview.chart.assets"),
              liabilities: t("nav.debt"),
            }}
            ariaLabel={t("chart.netWorthBreakdown.ariaLabel", {
              timeframe,
              start: series[0] ? formatDate(series[0].date) : "",
              end: series.length ? formatDate(series[series.length - 1].date) : "",
              net: formatCurrency(netWorth, currency),
            })}
          />
        ) : (
          <PerformanceChart
            series={series}
            scale={scale}
            mode={chartMode}
            currency={currency}
            compare={compare}
            mainLabel={returnScoped ? t("stat.depotValue") : headlineLabel}
            returnSeries={returnSeries}
            ariaLabel={
              returnScoped
                ? t("chart.depotReturn.ariaLabel", {
                    timeframe,
                    start: series[0] ? formatDate(series[0].date) : "",
                    end: series.length ? formatDate(series[series.length - 1].date) : "",
                    pct: formatPercent(risk.twr),
                  })
                : t("chart.netWorth.ariaLabel", {
                    timeframe,
                    start: series[0] ? formatDate(series[0].date) : "",
                    end: series.length ? formatDate(series[series.length - 1].date) : "",
                    change: formatCurrency(periodChange.abs, currency),
                    pct: formatPercent(periodChange.pct),
                  })
            }
          />
        )}
      </div>

      {showScopeNote && (
        <p className="mt-2 text-xs text-zinc-500">{t("chart.returnScope")}</p>
      )}

      {/* Risk/return figures (TWR, volatility, drawdown) are depot metrics.
          The overview answers "what am I worth", not "how did the depot
          perform", so they render on /portfolio only (spec §9/§17). */}
      {investmentsOnly && data.assets.length > 0 && (
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
    <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-zinc-200 text-center text-zinc-400 dark:border-zinc-800">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
      <p className="text-sm">{t("chart.loading")}</p>
    </div>
  );
}

function EmptyChart() {
  const { t } = useI18n();
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 text-center text-zinc-500 dark:border-zinc-700">
      <p className="font-medium">{t("empty.noHoldings")}</p>
      <p className="text-sm">{t("empty.addFirst")}</p>
    </div>
  );
}
