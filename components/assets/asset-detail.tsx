"use client";

// Asset detail page (PRD §4.1 detail chart + §4.2 detail panel): price chart
// with buy/sell markers, advanced metrics (IRR, master data, dividends,
// realized/unrealized P&L) and the transaction log.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { Timeframe } from "@/lib/finance/dates";
import {
  assetPriceSeries,
  summarizeHolding,
  transactionsByAsset,
} from "@/lib/finance/portfolio";
import { positionIRR } from "@/lib/finance/irr";
import { annualYield, dividendHistory, totalDividends } from "@/lib/finance/dividends";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  plColor,
} from "@/lib/format";
import { assetIdentifier } from "@/lib/types";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { constituentsFor } from "@/lib/catalog/catalog";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { SyncStatus } from "@/components/sync-status";
import { ChartControls } from "@/components/charts/chart-controls";
import {
  PerformanceChart,
  type ChartMode,
  type ChartScale,
  type ChartMarker,
} from "@/components/charts/performance-chart";
import { TransactionForm } from "./transaction-form";

export function AssetDetail({ assetId }: { assetId: string }) {
  const { data, loading, deleteAsset, deleteTransaction } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const router = useRouter();
  const currency = data.profile.currency;

  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [scale, setScale] = useState<ChartScale>("linear");
  const [mode, setMode] = useState<ChartMode>("currency");

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
  const { histories } = useHistory(histItems, timeframe, data.profile.currency);

  const series = useMemo(
    () => (asset ? assetPriceSeries(asset, timeframe, valuation, histories) : []),
    [asset, timeframe, valuation, histories],
  );

  const markers: ChartMarker[] = useMemo(
    () => txs.map((t) => ({ date: t.date, type: t.type })),
    [txs],
  );

  const irr = useMemo(
    () => (summary ? positionIRR(txs, summary.marketValue) : null),
    [txs, summary],
  );

  const dividends = useMemo(
    () => (asset ? dividendHistory(asset, txs) : []),
    [asset, txs],
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
  const yld = annualYield(asset);
  // Per-asset figures are in the native trading currency; portfolio figures
  // (market value, P&L) are in the base currency.
  const nativeCur = summary.currency || currency;

  async function handleDelete() {
    if (confirm(`Delete ${asset!.name} and all its transactions?`)) {
      await deleteAsset(asset!.id);
      router.push("/");
    }
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
              Holding value {formatCurrency(summary.marketValue, currency)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatus />
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>

      {/* Price chart */}
      <Card>
        <ChartControls
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          scale={scale}
          onScale={setScale}
          mode={mode}
          onMode={setMode}
        />
        <div className="mt-4">
          <PerformanceChart
            series={series}
            scale={scale}
            mode={mode}
            currency={nativeCur}
            markers={markers}
            color="#6366f1"
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          <span className="text-emerald-500">▮</span> buy &nbsp;
          <span className="text-red-500">▮</span> sell
        </p>
      </Card>

      {/* ETF look-through */}
      {constituents.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Top holdings</h2>
            <p className="text-xs text-zinc-500">
              Representative constituents · your exposure shown per stock
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {constituents
              .slice()
              .sort((a, b) => b.weight - a.weight)
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
                  <span className="w-28 shrink-0 text-right tabular-nums text-zinc-500">
                    {formatNumber(c.weight * 100, 1)}% ·{" "}
                    {formatCurrency(summary.marketValue * c.weight, currency)}
                  </span>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Advanced metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Market value" value={formatCurrency(summary.marketValue, currency)} />
        </Card>
        <Card>
          <Stat
            label="Unrealized P&L"
            value={formatCurrency(summary.unrealizedPL, currency)}
            sub={formatPercent(summary.unrealizedPLPercent)}
            valueClassName={plColor(summary.unrealizedPL)}
          />
        </Card>
        <Card>
          <Stat
            label="Realized P&L"
            value={formatCurrency(summary.realizedPL, currency)}
            valueClassName={plColor(summary.realizedPL)}
          />
        </Card>
        <Card>
          <Stat
            label="IRR (annualized)"
            value={irr === null ? "—" : formatPercent(irr)}
            valueClassName={irr === null ? "" : plColor(irr)}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Master data + dividends */}
        <Card className="lg:col-span-1">
          <h2 className="text-lg font-semibold">Details</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Name" value={asset.name} />
            <Row label="ISIN" value={asset.isin ?? "—"} />
            <Row label="WKN" value={asset.wkn ?? "—"} />
            {asset.symbol && <Row label="Symbol" value={asset.symbol} />}
            <Row label="Currency" value={nativeCur} />
            <Row label="Shares held" value={formatNumber(summary.position.shares, 4)} />
            <Row label="Avg. cost" value={formatCurrency(summary.position.avgCost, nativeCur)} />
            <Row label="Current price" value={formatCurrency(summary.price, nativeCur)} />
            <Row label="Cost basis" value={formatCurrency(summary.position.costBasis, nativeCur)} />
            <Row label="Total fees" value={formatCurrency(summary.position.totalFees, nativeCur)} />
            <Row
              label="Dividend yield"
              value={yld > 0 ? formatPercent(yld) : "—"}
            />
            <Row
              label="Dividends received"
              value={divTotal > 0 ? formatCurrency(divTotal, nativeCur) : "—"}
            />
          </dl>
        </Card>

        {/* Transactions */}
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Transactions</h2>
          </div>
          {txs.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No transactions yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3 text-right">Price</th>
                    <th className="py-2 pr-3 text-right">Fee</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...txs]
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .map((t) => (
                      <tr key={t.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
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
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatNumber(t.quantity, 4)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatCurrency(t.price, currency)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatCurrency(t.fee, currency)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatCurrency(t.quantity * t.price, currency)}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => void deleteTransaction(t.id)}
                            className="text-xs text-zinc-400 hover:text-red-500"
                            aria-label="Delete transaction"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h3 className="mb-3 text-sm font-semibold">Add transaction</h3>
            <TransactionForm asset={asset} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
