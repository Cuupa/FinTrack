"use client";

// Asset detail page (PRD §4.1 detail chart + §4.2 detail panel): price chart
// with buy/sell markers, advanced metrics (IRR, master data, dividends,
// realized/unrealized P&L) and the transaction log.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { addDays, nowDateTimeLocal, today, type Timeframe } from "@/lib/finance/dates";
import {
  assetPriceSeries,
  summarizeHolding,
  transactionsByAsset,
} from "@/lib/finance/portfolio";
import { positionIRR } from "@/lib/finance/irr";
import { dividendsFromEvents, totalDividends } from "@/lib/finance/dividends";
import { useDividends } from "@/lib/history/use-dividends";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  parseDecimal,
  plColor,
} from "@/lib/format";
import {
  assetIdentifier,
  type Portfolio,
  type Transaction,
  type TransactionType,
} from "@/lib/types";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { constituentsFor } from "@/lib/catalog/catalog";
import { quoteItemFor } from "@/lib/finance/prices";
import { assetAnnualStats } from "@/lib/finance/stats";
import { useHistory } from "@/lib/history/use-history";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { useI18n } from "@/lib/i18n/i18n-context";

export function AssetDetail({ assetId }: { assetId: string }) {
  const { data, loading, deleteAsset, deleteTransaction, updateTransaction, portfolios } =
    usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const router = useRouter();
  // Subscribe to the locale so figures re-format when the language changes
  // (this page formats currency without otherwise consuming the i18n context).
  useI18n();
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
  const compare = useBenchmarkCompare(benchmarks, currency);
  const toggleBenchmark = (id: string) =>
    setBenchmarks((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));

  const asset = data.assets.find((a) => a.id === assetId);
  const txs = useMemo(
    () => (asset ? transactionsByAsset(asset.id, data.transactions) : []),
    [asset, data.transactions],
  );

  const summary = useMemo(
    () => (asset ? summarizeHolding(asset, txs, valuation) : null),
    [asset, txs, valuation],
  );

  const histItems = useMemo(() => {
    const it = asset ? quoteItemFor(asset) : null;
    return it ? [it] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, version]);
  const { histories, loading: historyLoading } = useHistory(
    histItems,
    timeframe,
    data.profile.currency,
  );

  const series = useMemo(
    () => (asset ? assetPriceSeries(asset, timeframe, valuation, histories) : []),
    [asset, timeframe, valuation, histories],
  );

  const irr = useMemo(
    () => (summary ? positionIRR(txs, summary.marketValue) : null),
    [txs, summary],
  );

  // Risk-adjusted return from this asset's price history over the timeframe.
  const annual = useMemo(
    () => (asset ? assetAnnualStats(asset, histories, 100) : null),
    [asset, histories],
  );

  // Real dividend events (accumulating funds return none → no phantom payouts).
  const divMap = useDividends(histItems);
  const dividends = useMemo(() => {
    const key = histItems[0]?.key;
    return key ? dividendsFromEvents(divMap[key] ?? [], txs) : [];
  }, [divMap, histItems, txs]);

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
    return <div className="h-96 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />;
  }

  if (!asset || !summary) {
    return (
      <Card>
        <p className="text-zinc-500">Asset not found.</p>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {asset.name}
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {assetIdentifier(asset)}
            </span>
            <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700">
              {asset.type}
            </span>
          </h1>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(summary.price, nativeCur)}
            </span>
            <span className="text-zinc-500">
              Holding value <span data-private>{formatCurrency(summary.marketValue, currency)}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>

      {/* Tags */}
      <AssetTags assetId={asset.id} />

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
        <div className="mt-3 flex justify-end">
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
              currency={nativeCur}
              markers={markers}
              color="#6366f1"
              compare={compare}
              mainLabel={asset.name}
              highlightType={highlight}
            />
          )}
        </div>
        <div
          className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500"
          onMouseLeave={() => setHighlight(null)}
        >
          {(
            [
              ["BUY", "buy", "text-emerald-500"],
              ["SELL", "sell", "text-red-500"],
              ["DIV", "dividend", "text-amber-500"],
            ] as const
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <Stat
            label="Market value"
            value={formatCurrency(summary.marketValue, currency)}
            info="Current value of this holding."
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label="Unrealized P&L"
            value={formatCurrency(summary.unrealizedPL, currency)}
            sub={formatPercent(summary.unrealizedPLPercent)}
            valueClassName={plColor(summary.unrealizedPL)}
            info="Paper gain/loss on shares still held."
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label="Realized P&L"
            value={formatCurrency(summary.realizedPL, currency)}
            valueClassName={plColor(summary.realizedPL)}
            info="Locked-in gain/loss from shares of this asset you have already sold."
            isPrivate
          />
        </Card>
        <Card>
          <Stat
            label="IRR (annualized)"
            value={irr === null ? "—" : formatPercent(irr)}
            valueClassName={irr === null ? "" : plColor(irr)}
            info="Money-weighted annual return for this position."
          />
        </Card>
        <Card>
          <Stat
            label="Sharpe ratio"
            value={annual?.sharpe != null ? formatNumber(annual.sharpe, 2) : "—"}
            valueClassName={annual?.sharpe != null ? plColor(annual.sharpe) : ""}
            info="Risk-adjusted return: annualised excess return (over a 2% risk-free rate) per unit of volatility, measured from this asset's price history."
          />
        </Card>
      </div>

      {/* Top 10 holdings (ETF look-through) + Details share one row */}
      <div className={`grid gap-4 ${constituents.length > 0 ? "lg:grid-cols-2" : ""}`}>
        {constituents.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Top 10 holdings</h2>
              <p className="text-xs text-zinc-500">
                Representative constituents · your exposure shown per stock
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {constituents
                .slice()
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 10)
                .map((c) => (
                  <div key={c.name} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 truncate">
                      {c.name}
                      {c.symbol && (
                        <span className="ml-1 font-mono text-xs text-zinc-500">{c.symbol}</span>
                      )}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.min(100, c.weight * 100 * 4)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-zinc-500">
                      {formatNumber(c.weight * 100, 1)}%
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        )}

        <Card>
          <h2 className="text-lg font-semibold">Details</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Name" value={asset.name} />
            <Row label="ISIN" value={asset.isin ?? "—"} />
            <Row label="WKN" value={asset.wkn ?? "—"} />
            {asset.symbol && <Row label="Symbol" value={asset.symbol} />}
            <Row label="Currency" value={nativeCur} />
            <Row label="Shares held" value={formatNumber(summary.position.shares, 4)} isPrivate />
            <Row label="Avg. cost" value={formatCurrency(summary.position.avgCost, nativeCur)} isPrivate />
            <Row label="Current price" value={formatCurrency(summary.price, nativeCur)} />
            <Row label="Cost basis" value={formatCurrency(summary.position.costBasis, nativeCur)} isPrivate />
            <Row label="Total fees" value={formatCurrency(summary.position.totalFees, nativeCur)} isPrivate />
            <Row label="Dividend yield" value={yld > 0 ? formatPercent(yld) : "—"} />
            <Row
              label="Dividends received"
              value={divTotal > 0 ? formatCurrency(divTotal, nativeCur) : "—"}
              isPrivate
            />
            <Row
              label="Volatility (p.a.)"
              value={annual && annual.vol > 0 ? `${formatNumber(annual.vol * 100, 1)}%` : "—"}
            />
            <Row
              label="Sharpe ratio"
              value={annual?.sharpe != null ? formatNumber(annual.sharpe, 2) : "—"}
            />
          </dl>
        </Card>
      </div>

      {/* Transactions — full width, add form above the table */}
      <Card>
        <h2 className="text-lg font-semibold">Transactions</h2>

        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-semibold">Add transaction</h3>
          <TransactionForm asset={asset} />
        </div>

        {txs.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No transactions yet.</p>
        ) : (
          <div className="mt-4">
            <TransactionsTable
              txs={txs}
              currency={nativeCur}
              portfolios={portfolios}
              onUpdate={(id, patch) => void updateTransaction(id, patch)}
              onDelete={(t) =>
                setPending({
                  title: "Delete transaction?",
                  message: `This ${t.type} of ${formatNumber(t.quantity, 4)} on ${formatDateTime(t.date)} will be removed.`,
                  action: () => void deleteTransaction(t.id),
                })
              }
            />
          </div>
        )}
      </Card>

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

type TxSortKey = "date" | "type" | "quantity" | "price" | "fee" | "total";

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
    case "total":
      return a.quantity * a.price - b.quantity * b.price;
  }
}

function TransactionsTable({
  txs,
  currency,
  portfolios,
  onUpdate,
  onDelete,
}: {
  txs: Transaction[];
  currency: string;
  portfolios: Portfolio[];
  onUpdate: (id: string, patch: Partial<Omit<Transaction, "id">>) => void;
  onDelete: (t: Transaction) => void;
}) {
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
            <TxTh label="Date" k="date" sort={sort} onSort={toggle} />
            <TxTh label="Type" k="type" sort={sort} onSort={toggle} />
            <TxTh label="Qty" k="quantity" align="right" sort={sort} onSort={toggle} />
            <TxTh label="Price" k="price" align="right" sort={sort} onSort={toggle} />
            <TxTh label="Fee" k="fee" align="right" sort={sort} onSort={toggle} />
            <TxTh label="Total" k="total" align="right" sort={sort} onSort={toggle} />
            {multiPortfolio && <th className="py-2 pr-3 font-medium">Portfolio</th>}
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
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {t.type}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums" data-private>
                  {formatNumber(t.quantity, 4)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatCurrency(t.price, currency)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums" data-private>
                  {formatCurrency(t.fee, currency)}
                </td>
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
                {multiPortfolio && (
                  <td className="py-2 pr-3 text-zinc-500">
                    {portfolios.find((p) => p.id === t.portfolioId)?.name ?? "—"}
                  </td>
                )}
                <td className="py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => setEditingId(t.id)}
                    className="px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label="Edit transaction"
                    title="Edit"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="inline h-3.5 w-3.5">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onDelete(t)}
                    className="px-1 text-zinc-400 hover:text-red-500"
                    aria-label="Delete transaction"
                    title="Delete"
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
  onSave,
  onCancel,
}: {
  tx: Transaction;
  portfolios: Portfolio[];
  multiPortfolio: boolean;
  onSave: (patch: Partial<Omit<Transaction, "id">>) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(tx.type);
  const [quantity, setQuantity] = useState(String(tx.quantity));
  const [price, setPrice] = useState(String(tx.price));
  const [fee, setFee] = useState(String(tx.fee));
  const [date, setDate] = useState(tx.date.slice(0, 16));
  const [portfolioId, setPortfolioId] = useState(tx.portfolioId);

  const cell = "w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

  const save = () => {
    const qty = parseDecimal(quantity);
    const px = parseDecimal(price);
    onSave({
      type,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : tx.quantity,
      price: Number.isFinite(px) && px >= 0 ? px : tx.price,
      fee: parseDecimal(fee) || 0,
      date,
      portfolioId,
    });
  };

  return (
    <tr className="border-b border-zinc-100 bg-zinc-50 last:border-0 dark:border-zinc-800/60 dark:bg-zinc-800/30">
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
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </td>
      <td className="py-1.5 pr-2">
        <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${cell} text-right`} />
      </td>
      <td className="py-1.5 pr-2">
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={`${cell} text-right`} />
      </td>
      <td className="py-1.5 pr-2">
        <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={`${cell} text-right`} />
      </td>
      <td className="py-1.5 pr-2 text-right text-xs text-zinc-400">—</td>
      {multiPortfolio && (
        <td className="py-1.5 pr-2">
          <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} className={cell}>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </td>
      )}
      <td className="py-1.5 text-right whitespace-nowrap">
        <button onClick={save} className="px-1.5 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400" aria-label="Save" title="Save">
          ✓
        </button>
        <button onClick={onCancel} className="px-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Cancel" title="Cancel">
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
  value: string;
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
