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
  summarizeHolding,
  transactionsByAsset,
} from "@/lib/finance/portfolio";
import { positionIRR } from "@/lib/finance/irr";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { useDividends } from "@/lib/history/use-dividends";
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
import { assetPriceKey, type Portfolio, type Transaction, type TransactionType } from "@/lib/types";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { constituentsFor, lookupInstrument } from "@/lib/catalog/catalog";
import { nativeCurrency, quoteItemFor } from "@/lib/finance/prices";
import { instrumentToAsset, watchlistItemToAsset } from "@/lib/finance/instrument-asset";
import { assetAnnualStats } from "@/lib/finance/stats";
import { useHistory } from "@/lib/history/use-history";
import { fetchLivePrice } from "@/lib/live/fetch-price";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyValue } from "@/components/ui/copy-value";
import { AssetIdentifiers } from "@/components/ui/asset-identifiers";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { ChartControls } from "@/components/charts/chart-controls";
import { BenchmarkPicker } from "@/components/charts/benchmark-picker";
import { useBenchmarkCompare } from "@/components/charts/use-benchmark-compare";
import {
  PerformanceChart,
  type ChartMode,
  type ChartScale,
  type ChartMarker,
} from "@/components/charts/performance-chart";
import { TransactionForm } from "./transaction-form";
import { AssetTags } from "./asset-tags";
import { AddAssetForm } from "./add-asset-form";
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
  const { data, loading, loadError, reload, deleteAsset, deleteTransaction, updateTransaction, portfolios } =
    usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const router = useRouter();
  // Subscribe to the locale so figures re-format when the language changes
  // (this page formats currency without otherwise consuming the i18n context).
  const { t } = useI18n();
  const currency = data.profile.currency;

  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [mode, setMode] = useState<ChartMode>("currency");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<ChartMarker["type"] | null>(null);
  const [pending, setPending] = useState<{
    title: string;
    message?: string;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);
  const [addingHolding, setAddingHolding] = useState(false);
  const compare = useBenchmarkCompare(benchmarks, currency);
  const toggleBenchmark = (id: string) =>
    setBenchmarks((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));

  // Resolve what this page is about, in order of preference: a held asset (by
  // id or, for the instrumentKey route, by price-key match), else a watchlist
  // item, else a bare catalog hit. `held` drives which UI renders — the full
  // held layout (byte-identical to before) or the reduced non-held one. The
  // synthesized assets carry a sentinel id (wl:/cat:) that never collides with
  // a real asset id, so `transactionsByAsset` below naturally returns [].
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
  // falling back to the synthetic walk. Cancel-guarded; state is only set in
  // the async continuation, never synchronously in the effect body.
  const [nonHeldPrice, setNonHeldPrice] = useState<number | null>(null);
  useEffect(() => {
    if (held || !asset || (asset.type !== "STOCK" && asset.type !== "ETF")) return;
    const q = asset.isin || asset.symbol;
    if (!q) return;
    let cancelled = false;
    const run = async () => {
      const p = await fetchLivePrice(q, nativeCurrency(asset, currency), asset.name);
      if (!cancelled) setNonHeldPrice(p);
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, asset?.id]);

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
  const { histories, loading: historyLoading } = useHistory(
    histItems,
    timeframe,
    data.profile.currency,
  );

  // CASH's price chart is meaningless (constant 1) — plot the position's
  // total value over time (balance evolving with deposits/withdrawals/
  // interest) instead, via the same replay logic as the net-worth chart.
  const { points: series, synthetic: syntheticSeries } = useMemo(() => {
    if (!asset) return { points: [], synthetic: false };
    if (asset.type === "CASH") {
      const { points, containsSynthetic } = assetValueSeries(asset, txs, timeframe, effectiveValuation, histories);
      return { points, synthetic: containsSynthetic };
    }
    return assetPriceSeries(asset, timeframe, effectiveValuation, histories);
  }, [asset, txs, timeframe, effectiveValuation, histories]);

  const irr = useMemo(
    () => (summary ? positionIRR(txs, summary.marketValue) : null),
    [txs, summary],
  );

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
  const rawType = String(asset.type);
  const typeKey = `assetType.${rawType}` as MessageKey;
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
            <span
              className="text-lg font-semibold tabular-nums"
              {...(asset.type === "CASH" ? { "data-private": "" } : {})}
            >
              {asset.type === "CASH"
                ? formatCurrency(summary.marketValue, currency)
                : formatCurrency(summary.price, nativeCur)}
            </span>
            {summary.syntheticPrice && <EstimatedBadge tip={t("data.estimatedPriceTip")} />}
            {held && asset.type !== "CASH" && (
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
        <div className="mt-3 flex items-center justify-between gap-2">
          {!historyLoading && syntheticSeries ? (
            <EstimatedBadge tip={t("data.estimatedChartTip")} />
          ) : (
            <span />
          )}
          <BenchmarkPicker selected={benchmarks} onToggle={toggleBenchmark} />
        </div>
        <div className="mt-4">
          {historyLoading ? (
            <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-200 text-center text-zinc-400 dark:border-zinc-800">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-600" />
              <p className="text-sm">Loading price history…</p>
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
                : ([["BOOKING", t("tx.booking"), "text-indigo-500"]] as [
                    ChartMarker["type"],
                    string,
                    string,
                  ][])),
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

      {/* Advanced metrics — directly under the chart */}
      {held && (
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
      )}

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
            {held && (
              <>
                <Row label={t("asset.row.shares")} value={formatNumber(summary.position.shares, 4)} isPrivate />
                {asset.type !== "CASH" && (
                  <Row label={t("asset.row.avgCost")} value={formatCurrency(summary.position.avgCost, nativeCur)} isPrivate />
                )}
              </>
            )}
            {asset.type !== "CASH" && (
              <Row label={t("asset.row.currentPrice")} value={formatCurrency(summary.price, nativeCur)} />
            )}
            {held && (
              <>
                <Row label={t("asset.row.costBasis")} value={formatCurrency(summary.position.costBasis, nativeCur)} isPrivate />
                {asset.type === "CASH" && (
                  <Row
                    label={t("asset.row.interestEarned")}
                    value={formatCurrency(summary.unrealizedPL, nativeCur)}
                    isPrivate
                  />
                )}
                <Row label={t("asset.row.totalFees")} value={formatCurrency(summary.position.totalFees, nativeCur)} isPrivate />
              </>
            )}
            {asset.type !== "CASH" && (
              <>
                <Row label={t("asset.row.divYield")} value={yld > 0 ? formatPercent(yld) : "—"} />
                {held && (
                  <Row
                    label={t("asset.row.divReceived")}
                    value={divTotal > 0 ? formatCurrency(divTotal, nativeCur) : "—"}
                    isPrivate
                  />
                )}
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

          {!held && (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <p className="text-sm text-zinc-500">{t("instrument.notHeld")}</p>
              {addingHolding ? (
                <Card className="mt-3">
                  <AddAssetForm
                    embedded
                    initialQuery={assetPriceKey(asset)}
                    onDone={() => setAddingHolding(false)}
                  />
                </Card>
              ) : (
                <Button variant="primary" className="mt-3" onClick={() => setAddingHolding(true)}>
                  {t("instrument.addToPortfolio")}
                </Button>
              )}
            </div>
          )}
        </Card>

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

      {/* Transactions — full width, add form above the table */}
      {held && (
        <Card>
          <h2 className="text-lg font-semibold">{t("asset.transactions")}</h2>

          <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="mb-3 text-sm font-semibold">{t("asset.addTransaction")}</h3>
            <TransactionForm asset={asset} />
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
    default:
      return type;
  }
}

type TxSortKey = "date" | "type" | "quantity" | "price" | "fee" | "tax" | "total";

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

function txCompare(a: Transaction, b: Transaction, key: TxSortKey): number {
  switch (key) {
    case "date":
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    case "type":
      return a.type.localeCompare(b.type);
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

  const rows = useMemo(
    () => [...txs].sort((a, b) => txCompare(a, b, sort.key) * sort.dir),
    [txs, sort],
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
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
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
                            : "text-red-600 dark:text-red-400"
                    }
                  >
                    {isCash ? txTypeLabel(tr, t.type, true) : t.type}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums" data-private>
                  {formatNumber(t.quantity, 4)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {isCash ? <span className="text-zinc-400">—</span> : formatCurrency(t.price, currency)}
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
                    t.type === "BUY"
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                  data-private
                >
                  {t.type === "BUY" ? "−" : "+"}
                  {formatCurrency(t.quantity * t.price, currency)}
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
    <>
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
          <select value={type} onChange={(e) => setType(e.target.value as TransactionType)} className={cell}>
            <option value="BUY">{isCash ? txTypeLabel(tr, "BUY", true) : "BUY"}</option>
            <option value="SELL">{isCash ? txTypeLabel(tr, "SELL", true) : "SELL"}</option>
            {isCash ? (
              <option value="INTEREST">{txTypeLabel(tr, "INTEREST", true)}</option>
            ) : (
              <option value="BOOKING">BOOKING</option>
            )}
          </select>
        </td>
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
      {/* The portfolio is only surfaced (and editable) while editing. */}
      {multiPortfolio && (
        <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800/60 dark:bg-zinc-800/30">
          <td colSpan={isCash ? 7 : 8} className="px-2 pb-2">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="shrink-0">{tr("tx.portfolio")}</span>
              <select
                value={portfolioId}
                onChange={(e) => setPortfolioId(e.target.value)}
                className={`${cell} max-w-xs`}
              >
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </td>
        </tr>
      )}
    </>
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
