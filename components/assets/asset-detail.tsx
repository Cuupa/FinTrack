"use client";

// Asset detail page (PRD §4.1 detail chart + §4.2 detail panel): price chart
// with buy/sell markers, advanced metrics (IRR, master data, dividends,
// realized/unrealized P&L) and the transaction log.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { addDays, nowDateTimeLocal, today, type Timeframe } from "@/lib/finance/dates";
import {
  assetPriceSeries,
  assetValueSeries,
  holdingPeriodProfit,
  summarizeHolding,
  transactionsByAsset,
} from "@/lib/finance/portfolio";
import { positionIRR } from "@/lib/finance/irr";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { useDividends } from "@/lib/history/use-dividends";
import { pendingSplits } from "@/lib/finance/splits";
import { useSplits } from "@/lib/history/use-splits";
import { isStorageFullError } from "@/lib/store/errors";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  parseDecimal,
  plColor,
  stripLeadingZero,
} from "@/lib/format";
import { assetPriceKey, type Asset, type Portfolio, type Transaction, type TransactionType } from "@/lib/types";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { constituentsFor, lookupInstrument } from "@/lib/catalog/catalog";
import { nativeCurrency, quoteItemFor } from "@/lib/finance/prices";
import {
  instrumentToAsset,
  resolveOrBuildHeldAsset,
  watchlistItemToAsset,
} from "@/lib/finance/instrument-asset";
import { assetAnnualStats } from "@/lib/finance/stats";
import { nextOccurrence } from "@/lib/finance/savings-plans";
import { useHistory } from "@/lib/history/use-history";
import { fetchLivePrice } from "@/lib/live/fetch-price";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyValue } from "@/components/ui/copy-value";
import { AssetIdentifiers } from "@/components/ui/asset-identifiers";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { PlanForm, INTERVAL_KEY } from "@/components/savings/plan-form";
import { useFeatureFlag, usePlanLimit } from "@/lib/flags/flags-context";
import { atLimit } from "@/lib/billing/limits";
import { ChartControls } from "@/components/charts/chart-controls";
import { CashInterestSection } from "@/components/assets/cash-interest-section";
import { BenchmarkPicker } from "@/components/charts/benchmark-picker";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import {
  PerformanceChart,
  type ChartMode,
  type ChartScale,
  type ChartMarker,
} from "@/components/charts/performance-chart";
import { BENCHMARKS, buildCustomBenchmark, type Benchmark } from "@/lib/finance/benchmarks";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";
import { TransactionForm } from "./transaction-form";
import { AssetTags } from "./asset-tags";
import { AssetDetailSkeleton } from "./asset-detail-skeleton";
import { LoadError } from "@/components/ui/load-error";
import { useI18n } from "@/lib/i18n/i18n-context";
import {MessageKey} from "@/lib/i18n/dictionaries";

export function AssetDetail({
  assetId,
  instrumentKey,
}: {
  assetId?: string;
  /** Renders a not-(yet-)held instrument: a watchlist item or a bare catalog
   * hit, resolved by ISIN/WKN/symbol/name (see lib/finance/instrument-asset.ts). */
  instrumentKey?: string;
}) {
  const {
    data,
    loading,
    loadError,
    reload,
    deleteAsset,
    deleteTransaction,
    updateTransaction,
    portfolios,
    addAsset,
    addSavingsPlan,
    addTransaction,
  } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const router = useRouter();
  const savingsPlansEnabled = useFeatureFlag("savingsPlans");
  const splitDetectionEnabled = useFeatureFlag("splitDetection");
  const cashInterestEnabled = useFeatureFlag("cashInterest");
  const billingEnabled = useFeatureFlag("billing");
  const { limit: savingsPlansLimit } = usePlanLimit("savingsPlans");
  // Subscribe to the locale so figures re-format when the language changes
  // (this page formats currency without otherwise consuming the i18n context).
  const { t } = useI18n();
  const currency = data.profile.currency;
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [reviewingSplits, setReviewingSplits] = useState(false);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  // Per-row user override for the booked ratio in the split review modal,
  // keyed by the event's date. Reset on open/close (never via effect — see
  // react-hooks/set-state-in-effect in CLAUDE.md).
  const [splitRowEdits, setSplitRowEdits] = useState<Map<string, string>>(new Map());

  function openSplitReview() {
    setSplitRowEdits(new Map());
    setSplitError(null);
    setReviewingSplits(true);
  }

  function closeSplitReview() {
    setReviewingSplits(false);
    setSplitRowEdits(new Map());
    setSplitError(null);
  }

  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [mode, setMode] = useState<ChartMode>("currency");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);
  const [customBenchmarks, setCustomBenchmarks] = useState<Benchmark[]>([]);
  const [highlight, setHighlight] = useState<ChartMarker["type"] | null>(null);
  const [pending, setPending] = useState<{
    title: string;
    message?: string;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);
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

  // Resolve what this page is about, in order of preference: a held asset (by
  // id or, for the instrumentKey route, by price-key match), else a watchlist
  // item, else a bare catalog hit. The layout is the same either way — `held`
  // only gates the handful of sections that genuinely need a real asset row
  // (delete, tags) — everything else (metrics, details, transactions) renders
  // for both, showing natural zero/empty states until a transaction is
  // booked. The synthesized assets carry a sentinel id (wl:/cat:) that never
  // collides with a real asset id, so `transactionsByAsset` below naturally
  // returns [] until `ensureHeldAsset` (below) turns it into a real one.
  const resolved = useMemo(() => {
    if (assetId) {
      const a = data.assets.find((x) => x.id === assetId);
      return a ? { asset: a, held: true } : null;
    }
    const key = instrumentKey?.trim().toUpperCase();
    if (!key) return null;
    const heldAsset = data.assets.find((a) => assetPriceKey(a) === key);
    if (heldAsset) return { asset: heldAsset, held: true };
    const watched = data.watchlist.find((w) => assetPriceKey(w) === key);
    if (watched) return { asset: watchlistItemToAsset(watched), held: false };
    const inst = lookupInstrument(key);
    if (inst) return { asset: instrumentToAsset(inst), held: false };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, instrumentKey, data.assets, data.watchlist, version]);

  const asset = resolved?.asset ?? null;
  const held = resolved?.held ?? false;

  const txs = useMemo(
    () => (asset ? transactionsByAsset(asset.id, data.transactions) : []),
    [asset, data.transactions],
  );

  // Non-held STOCK/ETF: a one-shot live price fetch so the header/chart show
  // a real price the same way the held path does, instead of only ever
  // falling back to the synthetic walk. `nonHeldFetchSig` is null when no
  // fetch applies (held, wrong type, or no isin/symbol); `loading` is derived
  // by comparing it against the settled signature (same pattern as
  // useDividends/useHistory) rather than a flag set synchronously in the
  // effect body, since the set-state-in-effect lint rule forbids that. While
  // loading, the headline price must never show the synthetic walk value
  // (user rule: no assumed price while a real one may still be loading), so
  // the header renders a Skeleton instead (see below).
  const nonHeldFetchSig = useMemo(() => {
    if (held || !asset || (asset.type !== "STOCK" && asset.type !== "ETF")) return null;
    const q = asset.isin || asset.symbol;
    return q ? `${asset.id}:${q}` : null;
  }, [held, asset]);
  const [nonHeldPriceState, setNonHeldPriceState] = useState<{
    sig: string | null;
    price: number | null;
  }>({ sig: null, price: null });
  useEffect(() => {
    if (!nonHeldFetchSig || !asset) return;
    const q = asset.isin || asset.symbol!;
    let cancelled = false;
    const run = async () => {
      const p = await fetchLivePrice(q, nativeCurrency(asset, currency), asset.name);
      if (!cancelled) setNonHeldPriceState({ sig: nonHeldFetchSig, price: p });
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonHeldFetchSig]);
  const nonHeldPrice = nonHeldPriceState.sig === nonHeldFetchSig ? nonHeldPriceState.price : null;
  const nonHeldPriceLoading = nonHeldFetchSig !== null && nonHeldPriceState.sig !== nonHeldFetchSig;

  // Valuation augmented with the fetched non-held price, so summarizeHolding
  // and the price series show it exactly like a cron-cached held price would.
  // Referentially equal to `valuation` (held path / no fetch yet) so nothing
  // downstream re-renders differently than before.
  const effectiveValuation = useMemo(() => {
    if (!asset || held || nonHeldPrice == null) return valuation;
    const key = assetPriceKey(asset);
    return { ...valuation, live: { ...(valuation.live ?? {}), [key]: nonHeldPrice } };
  }, [valuation, asset, held, nonHeldPrice]);

  const summary = useMemo(
    () => (asset ? summarizeHolding(asset, txs, effectiveValuation) : null),
    [asset, txs, effectiveValuation],
  );

  // CASH has no market price history to fetch (its price is a constant 1,
  // not something a data provider tracks) — never request it.
  const histItems = useMemo(() => {
    const it = asset && asset.type !== "CASH" ? quoteItemFor(asset) : null;
    return it ? [it] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, version]);
  const { histories, fx, loading: historyLoading } = useHistory(
    histItems,
    timeframe,
    data.profile.currency,
  );

  // Layers the fetched historical FX series on top of effectiveValuation so
  // the value/price chart series below convert each historical point at the
  // FX rate of ITS OWN date instead of today's spot rate (rateOn in
  // portfolio.ts). Kept separate from effectiveValuation (used above for
  // summarizeHolding, which stays spot on purpose) so summarizeHolding's
  // referential-equality guarantees are unaffected.
  const chartValuation = useMemo(() => {
    if (!fx || Object.keys(fx).length === 0) return effectiveValuation;
    return { ...effectiveValuation, fxHistory: fx };
  }, [effectiveValuation, fx]);

  // CASH's price chart is meaningless (constant 1) — plot the position's
  // total value over time (balance evolving with deposits/withdrawals/
  // interest) instead, via the same replay logic as the net-worth chart.
  const { points: series, synthetic: syntheticSeries } = useMemo(() => {
    if (!asset) return { points: [], synthetic: false };
    if (asset.type === "CASH") {
      const { points, containsSynthetic } = assetValueSeries(asset, txs, timeframe, chartValuation, histories);
      return { points, synthetic: containsSynthetic };
    }
    return assetPriceSeries(asset, timeframe, chartValuation, histories, txs);
  }, [asset, txs, timeframe, chartValuation, histories]);

  const irr = useMemo(
    () => (summary ? positionIRR(txs, summary.marketValue) : null),
    [txs, summary],
  );

  // Return over the selected chart timeframe. A held position uses the
  // contribution-adjusted return (same methodology as the dashboard hero's
  // windowChange, so mid-window buys/sells don't distort it); a not-held
  // instrument (no transactions) falls back to the price series' plain
  // first-to-last change. Null until a usable series is available.
  const timeframeReturn = useMemo(() => {
    if (!asset) return null;
    if (txs.length > 0) return holdingPeriodProfit(asset, txs, timeframe, chartValuation, histories).pct;
    if (series.length >= 2 && series[0].value > 0) {
      return (series[series.length - 1].value - series[0].value) / series[0].value;
    }
    return null;
  }, [asset, txs, timeframe, chartValuation, histories, series]);

  // Risk-adjusted return from this asset's price history over the timeframe.
  const annual = useMemo(
    () => (asset ? assetAnnualStats(asset, histories, 100) : null),
    [asset, histories],
  );

  // Real dividend events (accumulating funds return none → no phantom
  // payouts; CASH isn't a security and never pays dividends — histItems is
  // already empty for it above, so this fetches nothing).
  const { dividends: divMap } = useDividends(histItems);
  const dividends = useMemo(() => {
    if (!asset || asset.type === "CASH") return [];
    const key = histItems[0]?.key;
    return key ? dividendsFromEvents(divMap[key] ?? [], txs) : [];
  }, [divMap, histItems, txs, asset]);

  // Real split events not yet booked (flag-gated; empty items when off, so no
  // fetch happens at all). No transactions → nothing to correct, so a
  // watchlist/catalog instrument never prompts.
  const { splits: splitMap } = useSplits(splitDetectionEnabled ? histItems : []);
  const pendingSplitEvents = useMemo(() => {
    if (!asset || !splitDetectionEnabled) return [];
    const key = histItems[0]?.key;
    if (!key) return [];
    return pendingSplits(splitMap[key] ?? [], txs);
  }, [asset, splitDetectionEnabled, histItems, splitMap, txs]);

  // Chart markers: buys/sells plus a marker on each dividend pay date.
  const markers: ChartMarker[] = useMemo(
    () => [
      ...txs.map((t) => ({ date: t.date, type: t.type as ChartMarker["type"] })),
      ...dividends.map((d) => ({ date: d.date, type: "DIV" as const })),
    ],
    [txs, dividends],
  );

  // ETF look-through: the fund's constituent stocks (depends on the catalog).
  const constituents = useMemo(
    () => (asset?.type === "ETF" ? constituentsFor(asset.symbol) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset, version],
  );

  if (loading) {
    return <AssetDetailSkeleton />;
  }

  if (loadError) {
    return <LoadError onRetry={reload} />;
  }

  if (!asset || !summary) {
    return (
      <Card>
        <p className="text-zinc-500">{instrumentKey ? t("instrument.notFound") : "Asset not found."}</p>
        <Link href="/" className="mt-2 inline-block text-sm underline">
          Back to dashboard
        </Link>
      </Card>
    );
  }

  const divTotal = totalDividends(dividends);
  // Trailing-12-month yield from real payouts (0 for accumulating funds).
  const cutoff = addDays(today(), -365);
  const ttmPerShare = dividends
    .filter((d) => d.date >= cutoff)
    .reduce((s, d) => s + d.perShare, 0);
  const yld = summary.price > 0 ? ttmPerShare / summary.price : 0;
  // Per-asset figures are in the native trading currency; portfolio figures
  // (market value, P&L) are in the base currency.
  const nativeCur = summary.currency || currency;
  // CASH's detail chart plots the position's total value (base currency, see
  // assetValueSeries above), not a native-currency price — label it as such.
  const chartCurrency = asset.type === "CASH" ? currency : nativeCur;

  // Passed to TransactionForm for a not-(yet-)held instrument only: resolves
  // (creating if necessary, deduped by price key — reuses an existing asset
  // rather than creating a duplicate) the real asset so the submitted
  // transaction has something real to book against. Once that transaction
  // lands in `data`, the `resolved` memo above finds the new held asset by
  // price key on the next render and this page "flips" to the held layout on
  // its own — no explicit navigation needed.
  async function ensureHeldAsset(): Promise<Asset> {
    const resolution = resolveOrBuildHeldAsset(data.assets, asset!);
    return "existing" in resolution ? resolution.existing : addAsset(resolution.input);
  }

  function handleDelete() {
    setPending({
      title: `Delete ${asset!.name}?`,
      message: "This removes the asset and all its transactions. This can't be undone.",
      confirmLabel: "Delete asset",
      action: async () => {
        await deleteAsset(asset!.id);
        router.push("/");
      },
    });
  }

  function setSplitRowEdit(date: string, ratio: string) {
    setSplitRowEdits((prev) => {
      const next = new Map(prev);
      next.set(date, ratio);
      return next;
    });
  }

  // Books each pending split as a SPLIT transaction. Sequential, not
  // parallel — same reasoning as the savings-plan review dialog (see
  // SavingsPlansCard confirmDue): a mid-way failure leaves the remaining
  // events still bookable on the next visit instead of racing partial writes.
  async function confirmSplits() {
    if (!asset) return;
    setSplitBusy(true);
    setSplitError(null);
    try {
      const portfolioId = txs[0]?.portfolioId ?? portfolios[0]?.id ?? "";
      for (const event of pendingSplitEvents) {
        const override = splitRowEdits.get(event.date);
        const ratio = override !== undefined ? parseDecimal(override) : event.ratio;
        if (!Number.isFinite(ratio) || ratio <= 0) continue;
        await addTransaction({
          assetId: asset.id,
          portfolioId,
          type: "SPLIT",
          quantity: ratio,
          price: 0,
          fee: 0,
          tax: 0,
          date: `${event.date}T00:00:00`,
        });
      }
      closeSplitReview();
    } catch (err) {
      setSplitError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : err instanceof Error
            ? err.message
            : t("tx.errFail"),
      );
    } finally {
      setSplitBusy(false);
    }
  }
  const rawType = String(asset.type);
  const typeKey = `assetType.${rawType}` as MessageKey;
  // Savings plans that already target this asset, shown read-only next to the
  // "new plan" entry point below (management stays on the dashboard card).
  const assetPlans = held && savingsPlansEnabled
    ? data.savingsPlans.filter((p) => p.assetId === asset.id)
    : [];
  // Plan-limit cap (MONETIZATION.md Phase 4): only blocks creating a NEW
  // plan from this page's "new plan" entry point, never the read-only list
  // above or an existing plan's own edit/pause/delete on the dashboard card.
  const savingsPlansCapped = atLimit(savingsPlansLimit, data.savingsPlans.length);
  const savingsPlansLimitHint = savingsPlansCapped ? (
    <>
      {t("sp.limitHint", { n: String(savingsPlansLimit) })}
      {billingEnabled && (
        <>
          {" "}
          <Link
            href="/pricing"
            className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            {t("common.proFeatureUpgrade")}
          </Link>
        </>
      )}
    </>
  ) : null;
  const multiPortfolio = portfolios.length > 1;
  const todayISO = today();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← {t("nav.dashboard")}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {asset.name}
            <AssetIdentifiers
              asset={asset}
              chipClassName="rounded bg-zinc-100 px-2 py-0.5 font-mono text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            />
            <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700">
              {t(typeKey)}
            </span>
          </h1>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            {/* CASH has no per-unit price (constant 1) — the headline is the
                position's total value instead, same as the "Holding value"
                subline uses for other asset types. */}
            {nonHeldPriceLoading ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <span
                className="text-lg font-semibold tabular-nums"
                {...(asset.type === "CASH" ? { "data-private": "" } : {})}
              >
                {asset.type === "CASH"
                  ? formatCurrency(summary.marketValue, currency)
                  : formatCurrency(summary.price, nativeCur)}
              </span>
            )}
            {!nonHeldPriceLoading && summary.syntheticPrice && (
              <EstimatedBadge tip={t("data.estimatedPriceTip")} />
            )}
            {asset.type !== "CASH" && (
              <span className="text-zinc-500">
                {t("common.holdingValue")} <span data-private>{formatCurrency(summary.marketValue, currency)}</span>
              </span>
            )}
          </div>
        </div>
        {held && (
          <div className="flex items-center gap-3">
            <Button variant="danger" onClick={handleDelete}>
              {t("asset.delete")}
            </Button>
          </div>
        )}
      </div>

      {/* Tags */}
      {held && <AssetTags assetId={asset.id} />}

      {/* Price chart */}
      <Card>
        <ChartControls
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          scale={scale}
          onScale={setScale}
          mode={mode}
          onMode={setMode}
          showMode={false}
        />
        {historyLoading ? (
          <div className="mt-3">
            <SkeletonText className="h-6 w-28" />
          </div>
        ) : timeframeReturn != null ? (
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-lg font-semibold tabular-nums ${plColor(timeframeReturn)}`} data-private>
              {formatPercent(timeframeReturn)}
            </span>
            <span className="text-xs text-zinc-500">{t("asset.periodReturn", { tf: timeframe })}</span>
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          {!historyLoading && syntheticSeries ? (
            <EstimatedBadge tip={t("data.estimatedChartTip")} />
          ) : (
            <span />
          )}
          <BenchmarkPicker
            selected={benchmarks}
            onToggle={toggleBenchmark}
            custom={customBenchmarks}
            onAddCustom={addCustomBenchmark}
            onRemoveCustom={removeCustomBenchmark}
          />
        </div>
        <div className="mt-4">
          {historyLoading ? (
            <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-200 text-center text-zinc-400 dark:border-zinc-800">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
              <p className="text-sm">{t("chart.loading")}</p>
            </div>
          ) : (
            <PerformanceChart
              series={series}
              scale={scale}
              mode={mode}
              currency={chartCurrency}
              markers={markers}
              color="#6366f1"
              compare={compare}
              mainLabel={asset.name}
              highlightType={highlight}
              ariaLabel={t("chart.assetPrice.ariaLabel", {
                name: asset.name,
                timeframe,
                start: series[0] ? formatDate(series[0].date) : "",
                end: series.length ? formatDate(series[series.length - 1].date) : "",
                startValue: series[0] ? formatCurrency(series[0].value, chartCurrency) : "",
                endValue: series.length
                  ? formatCurrency(series[series.length - 1].value, chartCurrency)
                  : "",
              })}
            />
          )}
        </div>
        <div
          className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500"
          onMouseLeave={() => setHighlight(null)}
        >
          {(
            [
              ["BUY", txTypeLabel(t, "BUY", asset.type === "CASH"), "text-emerald-500"],
              ["SELL", txTypeLabel(t, "SELL", asset.type === "CASH"), "text-red-500"],
              ...(asset.type === "CASH"
                ? ([["INTEREST", t("tx.interest"), "text-amber-500"]] as [
                    ChartMarker["type"],
                    string,
                    string,
                  ][])
                : ([
                    ["BOOKING", t("tx.booking"), "text-indigo-500"],
                    ["SPLIT", t("tx.split"), "text-purple-500"],
                  ] as [ChartMarker["type"], string, string][])),
              // CASH never pays dividends (see the gated dividends/[]
              // computation above) — no DIV legend entry to toggle.
              ...(asset.type === "CASH"
                ? []
                : ([["DIV", t("tx.dividend"), "text-amber-500"]] as [
                    ChartMarker["type"],
                    string,
                    string,
                  ][])),
            ] as [ChartMarker["type"], string, string][]
          ).map(([type, label, color]) => (
            <button
              key={type}
              type="button"
              onMouseEnter={() => setHighlight(type)}
              onFocus={() => setHighlight(type)}
              onBlur={() => setHighlight(null)}
              className={`inline-flex items-center gap-1 transition-opacity hover:text-zinc-800 dark:hover:text-zinc-200 ${
                highlight && highlight !== type ? "opacity-40" : ""
              }`}
            >
              <span className={color}>▮</span> {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Advanced metrics — directly under the chart. Zero/empty for a
          not-(yet-)held instrument (no transactions), same as any freshly
          added holding. */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <Stat
            label={t("common.marketValue")}
            value={formatCurrency(summary.marketValue, currency)}
            info={t("tip.marketValue")}
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label={t("stat.unrealized")}
            value={formatCurrency(summary.unrealizedPL, currency)}
            sub={formatPercent(summary.unrealizedPLPercent)}
            valueClassName={plColor(summary.unrealizedPL)}
            info={t("tip.unrealized")}
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label={t("stat.realized")}
            value={formatCurrency(summary.realizedPL, currency)}
            valueClassName={plColor(summary.realizedPL)}
            info={t("tip.realized")}
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label={t("asset.metric.irr")}
            value={irr === null ? "—" : formatPercent(irr)}
            valueClassName={irr === null ? "" : plColor(irr)}
            info={t("asset.metric.irrTip")}
          />
        </Card>
        <Card>
          <Stat
            label={t("asset.metric.sharpe")}
            value={annual?.sharpe != null ? formatNumber(annual.sharpe, 2) : "—"}
            valueClassName={annual?.sharpe != null ? plColor(annual.sharpe) : ""}
            info={t("asset.metric.sharpeTip")}
          />
        </Card>
      </div>

      {/* Details + Top 10 holdings (ETF look-through) share one row, Details
          twice as wide (2:1). */}
      <div className={`grid gap-4 ${constituents.length > 0 ? "lg:grid-cols-3" : ""}`}>
        <Card className={constituents.length > 0 ? "lg:col-span-2" : ""}>
          <h2 className="text-lg font-semibold">{t("asset.details")}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row label={t("asset.row.name")} value={asset.name} />
            <Row
              label={t("asset.row.isin")}
              value={asset.isin ? <CopyValue value={asset.isin} /> : "—"}
            />
            <Row
              label={t("asset.row.wkn")}
              value={asset.wkn ? <CopyValue value={asset.wkn} /> : "—"}
            />
            {asset.symbol && (
              <Row label={t("asset.row.symbol")} value={<CopyValue value={asset.symbol} />} />
            )}
            <Row label={t("asset.row.currency")} value={nativeCur} />
            <Row label={t("asset.row.shares")} value={formatNumber(summary.position.shares, 4)} isPrivate />
            {asset.type !== "CASH" && (
              <Row label={t("asset.row.avgCost")} value={formatCurrency(summary.position.avgCost, nativeCur)} isPrivate />
            )}
            {asset.type !== "CASH" && (
              <Row
                label={t("asset.row.currentPrice")}
                value={
                  nonHeldPriceLoading ? (
                    <SkeletonText className="ml-auto h-3.5 w-16" />
                  ) : (
                    formatCurrency(summary.price, nativeCur)
                  )
                }
              />
            )}
            <Row label={t("asset.row.costBasis")} value={formatCurrency(summary.position.costBasis, nativeCur)} isPrivate />
            {asset.type === "CASH" && (
              <Row
                label={t("asset.row.interestEarned")}
                value={formatCurrency(summary.unrealizedPL, nativeCur)}
                isPrivate
              />
            )}
            <Row label={t("asset.row.totalFees")} value={formatCurrency(summary.position.totalFees, nativeCur)} isPrivate />
            {asset.type !== "CASH" && (
              <>
                <Row label={t("asset.row.divYield")} value={yld > 0 ? formatPercent(yld) : "—"} />
                <Row
                  label={t("asset.row.divReceived")}
                  value={divTotal > 0 ? formatCurrency(divTotal, nativeCur) : "—"}
                  isPrivate
                />
              </>
            )}
            <Row
              label={t("asset.row.volatility")}
              value={annual && annual.vol > 0 ? `${formatNumber(annual.vol * 100, 1)}%` : "—"}
            />
            <Row
              label={t("asset.row.sharpe")}
              value={annual?.sharpe != null ? formatNumber(annual.sharpe, 2) : "—"}
            />
          </dl>
        </Card>

        {held && asset.type === "CASH" && cashInterestEnabled && (
          <CashInterestSection asset={asset} txs={txs} />
        )}

        {constituents.length > 0 && (
          <Card>
            <h2 className="text-lg font-semibold">{t("asset.topHoldings")}</h2>
            <div className="mt-3 space-y-2.5">
              {constituents
                .slice()
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 10)
                .map((c) => (
                  <div key={c.name} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {c.name}
                        {c.symbol && (
                          <span className="ml-1 font-mono text-xs text-zinc-500">{c.symbol}</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-500">
                        {formatNumber(c.weight * 100, 1)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.min(100, c.weight * 100 * 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        )}
      </div>

      {/* Transactions — full width, add form above the table. Booking the
          first transaction on a not-(yet-)held instrument is what turns it
          into a holding (see ensureHeldAsset above). */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("asset.transactions")}</h2>
          {held && savingsPlansEnabled && (
            <Button size="sm" variant="secondary" onClick={() => setPlanModalOpen(true)}>
              {t("sp.newFromAsset")}
            </Button>
          )}
        </div>

        {pendingSplitEvents.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
            <span className="text-sm text-amber-800 dark:text-amber-300">
              {t("splits.detected", { count: pendingSplitEvents.length })}
            </span>
            <Button size="sm" variant="primary" onClick={openSplitReview}>
              {t("splits.review")}
            </Button>
          </div>
        )}

        {assetPlans.length > 0 && (
          <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <h3 className="border-b border-zinc-200 px-3 py-2 text-sm font-semibold dark:border-zinc-800">
              {t("sp.title")}
            </h3>
            <ul>
              {assetPlans.map((plan) => {
                const portfolioName = portfolios.find((p) => p.id === plan.portfolioId)?.name;
                return (
                  <li
                    key={plan.id}
                    className="border-b border-zinc-100 px-3 py-2 text-sm last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                  >
                    {multiPortfolio && portfolioName && (
                      <span
                        className={`block truncate text-sm font-medium ${
                          plan.active ? "" : "text-zinc-400 dark:text-zinc-500"
                        }`}
                      >
                        {portfolioName}
                      </span>
                    )}
                    <span
                      className={
                        multiPortfolio
                          ? "block truncate text-xs text-zinc-500"
                          : `block truncate ${plan.active ? "" : "text-zinc-400 dark:text-zinc-500"}`
                      }
                    >
                      <span data-private>{formatCurrency(plan.amount, nativeCur)}</span>{" "}
                      {t(INTERVAL_KEY[plan.interval])}
                      {plan.bookingType === "BOOKING" && <> · {t("tx.booking")}</>}
                      {plan.active ? (
                        <> · {t("sp.next", { date: formatDate(nextOccurrence(plan, todayISO)) })}</>
                      ) : (
                        <> · {t("sp.paused")}</>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-semibold">{t("asset.addTransaction")}</h3>
          <TransactionForm asset={asset} ensureAsset={held ? undefined : ensureHeldAsset} />
        </div>

        {txs.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t("asset.noTransactions")}</p>
        ) : (
          <div className="mt-4">
            <TransactionsTable
              txs={txs}
              currency={nativeCur}
              portfolios={portfolios}
              isCash={asset.type === "CASH"}
              onUpdate={(id, patch) => void updateTransaction(id, patch)}
              onDelete={(tx) =>
                setPending({
                  title: t("tx.deleteConfirmTitle"),
                  message: `${tx.type} · ${formatNumber(tx.quantity, 4)} · ${formatDateTime(tx.date)}`,
                  action: () => void deleteTransaction(tx.id),
                })
              }
            />
          </div>
        )}
      </Card>

      {held && savingsPlansEnabled && (
        <Modal open={planModalOpen} onClose={() => setPlanModalOpen(false)}>
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t("sp.newFromAsset")}</h3>
            <PlanForm
              fixedAsset={asset}
              onSubmit={async (values) => {
                await addSavingsPlan({ ...values, active: true, lastRunDate: null });
                setPlanModalOpen(false);
              }}
              onDone={() => setPlanModalOpen(false)}
              limitReached={savingsPlansLimitHint}
            />
          </div>
        </Modal>
      )}

      {splitDetectionEnabled && (
        <Modal
          open={reviewingSplits}
          onClose={() => {
            if (!splitBusy) closeSplitReview();
          }}
        >
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t("splits.modalTitle")}</h3>
            <div className="space-y-2">
              {pendingSplitEvents.map((event) => (
                <div
                  key={event.date}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <span className="text-sm">{formatDate(event.date)}</span>
                  <label className="flex items-center gap-2 text-sm text-zinc-500">
                    {t("splits.ratio")}
                    <input
                      inputMode="decimal"
                      value={splitRowEdits.get(event.date) ?? String(event.ratio)}
                      onChange={(e) =>
                        setSplitRowEdit(event.date, stripLeadingZero(e.target.value))
                      }
                      className="w-20 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  </label>
                </div>
              ))}
            </div>
            {splitError && <p className="text-sm text-red-600 dark:text-red-400">{splitError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={splitBusy} onClick={closeSplitReview}>
                {t("tx.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={splitBusy || pendingSplitEvents.length === 0}
                onClick={() => void confirmSplits()}
              >
                {t("splits.bookAll", { count: pendingSplitEvents.length })}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        message={pending?.message}
        confirmLabel={pending?.confirmLabel}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          pending?.action();
          setPending(null);
        }}
      />
    </div>
  );
}

// Display-only relabeling for cash: BUY/SELL are stored as-is (the finance
// layer never sees the difference) but read as Deposit/Withdrawal in the UI.
function txTypeLabel(t: (key: MessageKey) => string, type: TransactionType, isCash: boolean): string {
  switch (type) {
    case "BUY":
      return isCash ? t("tx.deposit") : t("tx.buy");
    case "SELL":
      return isCash ? t("tx.withdrawal") : t("tx.sell");
    case "BOOKING":
      return t("tx.booking");
    case "INTEREST":
      return t("tx.interest");
    case "SPLIT":
      return t("tx.split");
    default:
      return type;
  }
}

type TxSortKey = "date" | "type" | "portfolio" | "quantity" | "price" | "fee" | "tax" | "total";

function TxTh({
  label,
  k,
  align = "left",
  sort,
  onSort,
}: {
  label: string;
  k: TxSortKey;
  align?: "left" | "right";
  sort: { key: TxSortKey; dir: 1 | -1 };
  onSort: (k: TxSortKey) => void;
}) {
  return (
    <th className={`py-2 pr-3 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        <span className="text-[10px]">
          {sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

function txCompare(
  a: Transaction,
  b: Transaction,
  key: TxSortKey,
  portfolioName: (id: string) => string,
): number {
  switch (key) {
    case "date":
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    case "type":
      return a.type.localeCompare(b.type);
    case "portfolio":
      return portfolioName(a.portfolioId).localeCompare(portfolioName(b.portfolioId));
    case "quantity":
      return a.quantity - b.quantity;
    case "price":
      return a.price - b.price;
    case "fee":
      return a.fee - b.fee;
    case "tax":
      return a.tax - b.tax;
    case "total":
      return a.quantity * a.price - b.quantity * b.price;
  }
}

function TransactionsTable({
  txs,
  currency,
  portfolios,
  isCash,
  onUpdate,
  onDelete,
}: {
  txs: Transaction[];
  currency: string;
  portfolios: Portfolio[];
  isCash: boolean;
  onUpdate: (id: string, patch: Partial<Omit<Transaction, "id">>) => void;
  onDelete: (t: Transaction) => void;
}) {
  // Aliased to `tr` — the row map below binds `t` to the transaction.
  const { t: tr } = useI18n();
  const [sort, setSort] = useState<{ key: TxSortKey; dir: 1 | -1 }>({
    key: "date",
    dir: -1,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const portfolioNameById = useMemo(() => {
    const map = new Map(portfolios.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? "";
  }, [portfolios]);

  const rows = useMemo(
    () => [...txs].sort((a, b) => txCompare(a, b, sort.key, portfolioNameById) * sort.dir),
    [txs, sort, portfolioNameById],
  );

  function toggle(key: TxSortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: (s.dir * -1) as 1 | -1 }
        : { key, dir: key === "date" ? -1 : 1 },
    );
  }

  const multiPortfolio = portfolios.length > 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <TxTh label={tr("tx.date")} k="date" sort={sort} onSort={toggle} />
            <TxTh label={tr("tx.type")} k="type" sort={sort} onSort={toggle} />
            {multiPortfolio && (
              <TxTh label={tr("tx.portfolio")} k="portfolio" sort={sort} onSort={toggle} />
            )}
            <TxTh label={tr("tx.qty")} k="quantity" align="right" sort={sort} onSort={toggle} />
            <TxTh label={tr("tx.price")} k="price" align="right" sort={sort} onSort={toggle} />
            <TxTh label={tr("tx.fee")} k="fee" align="right" sort={sort} onSort={toggle} />
            {!isCash && (
              <TxTh label={tr("tx.tax")} k="tax" align="right" sort={sort} onSort={toggle} />
            )}
            <TxTh label={tr("tx.total")} k="total" align="right" sort={sort} onSort={toggle} />
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) =>
            editingId === t.id ? (
              <TransactionEditRow
                key={t.id}
                tx={t}
                portfolios={portfolios}
                multiPortfolio={multiPortfolio}
                isCash={isCash}
                onSave={(patch) => {
                  onUpdate(t.id, patch);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <tr
                key={t.id}
                className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
              >
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(t.date)}</td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      t.type === "BUY"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : t.type === "BOOKING"
                          ? "text-indigo-600 dark:text-indigo-400"
                          : t.type === "INTEREST"
                            ? "text-amber-600 dark:text-amber-400"
                            : t.type === "SPLIT"
                              ? "text-purple-600 dark:text-purple-400"
                              : "text-red-600 dark:text-red-400"
                    }
                  >
                    {isCash ? txTypeLabel(tr, t.type, true) : t.type}
                  </span>
                </td>
                {multiPortfolio && (
                  <td className="py-2 pr-3 text-zinc-500">
                    {portfolioNameById(t.portfolioId) || (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                )}
                <td className="py-2 pr-3 text-right tabular-nums" data-private>
                  {t.type === "SPLIT" ? `×${formatNumber(t.quantity, 4)}` : formatNumber(t.quantity, 4)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {isCash || t.type === "SPLIT" ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    formatCurrency(t.price, currency)
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums" data-private>
                  {formatCurrency(t.fee, currency)}
                </td>
                {!isCash && (
                  <td className="py-2 pr-3 text-right tabular-nums" data-private>
                    {formatCurrency(t.tax, currency)}
                  </td>
                )}
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    t.type === "SPLIT"
                      ? "text-zinc-400"
                      : t.type === "BUY"
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                  data-private
                >
                  {t.type === "SPLIT" ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <>
                      {t.type === "BUY" ? "−" : "+"}
                      {formatCurrency(t.quantity * t.price, currency)}
                    </>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => setEditingId(t.id)}
                    className="px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label={tr("tx.edit")}
                    title={tr("tx.edit")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="inline h-3.5 w-3.5">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onDelete(t)}
                    className="px-1 text-zinc-400 hover:text-red-500"
                    aria-label={tr("tx.deleteTitle")}
                    title={tr("tx.deleteTitle")}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function TransactionEditRow({
  tx,
  portfolios,
  multiPortfolio,
  isCash,
  onSave,
  onCancel,
}: {
  tx: Transaction;
  portfolios: Portfolio[];
  multiPortfolio: boolean;
  isCash: boolean;
  onSave: (patch: Partial<Omit<Transaction, "id">>) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(tx.type);
  const [quantity, setQuantity] = useState(String(tx.quantity));
  const [price, setPrice] = useState(String(tx.price));
  const [fee, setFee] = useState(String(tx.fee));
  const [tax, setTax] = useState(String(tx.tax));
  const [date, setDate] = useState(tx.date.slice(0, 16));
  const [portfolioId, setPortfolioId] = useState(tx.portfolioId);

  const { t: tr } = useI18n();
  const cell = "w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

  const save = () => {
    const qty = parseDecimal(quantity);
    const px = parseDecimal(price);
    onSave({
      type,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : tx.quantity,
      price: Number.isFinite(px) && px >= 0 ? px : tx.price,
      fee: parseDecimal(fee) || 0,
      tax: isCash ? tx.tax : parseDecimal(tax) || 0,
      date,
      portfolioId,
    });
  };

  return (
    <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-800/30">
      <td className="py-1.5 pr-2">
        <input
          type="datetime-local"
          value={date}
          max={nowDateTimeLocal()}
          onChange={(e) => setDate(e.target.value)}
          className={cell}
        />
      </td>
      <td className="py-1.5 pr-2">
        <SelectMenu
          value={type}
          onChange={(v) => setType(v as TransactionType)}
          className={cell}
          ariaLabel={tr("tx.type")}
          options={[
            { value: "BUY", label: isCash ? txTypeLabel(tr, "BUY", true) : "BUY" },
            { value: "SELL", label: isCash ? txTypeLabel(tr, "SELL", true) : "SELL" },
            isCash
              ? { value: "INTEREST", label: txTypeLabel(tr, "INTEREST", true) }
              : { value: "BOOKING", label: "BOOKING" },
            ...(!isCash ? [{ value: "SPLIT", label: "SPLIT" }] : []),
          ]}
        />
      </td>
      {multiPortfolio && (
        <td className="py-1.5 pr-2">
          <SelectMenu
            value={portfolioId}
            onChange={setPortfolioId}
            className={cell}
            ariaLabel={tr("tx.portfolio")}
            options={portfolios.map((p) => ({ value: p.id, label: p.name }))}
          />
        </td>
      )}
      <td className="py-1.5 pr-2">
        <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(stripLeadingZero(e.target.value))} className={`${cell} text-right`} />
      </td>
      <td className="py-1.5 pr-2">
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(stripLeadingZero(e.target.value))} className={`${cell} text-right`} />
      </td>
      <td className="py-1.5 pr-2">
        <input inputMode="decimal" value={fee} onChange={(e) => setFee(stripLeadingZero(e.target.value))} className={`${cell} text-right`} />
      </td>
      {!isCash && (
        <td className="py-1.5 pr-2">
          <input inputMode="decimal" value={tax} onChange={(e) => setTax(stripLeadingZero(e.target.value))} className={`${cell} text-right`} />
        </td>
      )}
      <td className="py-1.5 pr-2 text-right text-xs text-zinc-400">—</td>
      <td className="py-1.5 text-right whitespace-nowrap">
        <button onClick={save} className="px-1.5 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400" aria-label={tr("tx.save")} title={tr("tx.save")}>
          ✓
        </button>
        <button onClick={onCancel} className="px-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label={tr("tx.cancel")} title={tr("tx.cancel")}>
          ✕
        </button>
      </td>
    </tr>
  );
}

function Row({
  label,
  value,
  isPrivate = false,
}: {
  label: string;
  value: ReactNode;
  isPrivate?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums" {...(isPrivate ? { "data-private": "" } : {})}>
        {value}
      </dd>
    </div>
  );
}
