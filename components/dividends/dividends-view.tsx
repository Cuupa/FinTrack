"use client";

// Dividend dashboard: aggregated income across all holdings from REAL payout
// events (/api/dividends) — income by month/year, personal dividend yield &
// yield on cost, per-holding breakdown, and a 12-month forecast projected from
// the trailing year's payouts. Accumulating funds pay nothing and show nothing.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { useDividends } from "@/lib/history/use-dividends";
import { dividendsFromEvents, type DividendPayment } from "@/lib/finance/dividends";
import {
  summarizeAll,
  transactionsByAsset,
  type HoldingSummary,
} from "@/lib/finance/portfolio";
import { addDays, today } from "@/lib/finance/dates";
import { assetPriceKey, type Asset } from "@/lib/types";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { Card, SegmentedControl, Stat } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCardSkeleton, ListRowSkeleton } from "@/components/dividends/dividends-skeleton";
import { useI18n } from "@/lib/i18n/i18n-context";
import { yAxisWidth } from "@/components/charts/axis";

const EMERALD = "#10b981";

interface AssetDividends {
  asset: Asset;
  /** Payments in the asset's currency. */
  payments: DividendPayment[];
  /** Native → base rate. */
  rate: number;
}

/** "2025-01" → "Jan '25" in the active locale. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mon = new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(y, m - 1, 1));
  return `${mon} '${String(y).slice(2)}`;
}

/** The 12 trailing month keys (oldest first), ending in the current month. */
function trailingMonths(todayISO: string): string[] {
  const [y, m] = todayISO.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function DividendsView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const { t } = useI18n();
  const currency = data.profile.currency;
  const todayISO = today();

  const [range, setRange] = useState<"12m" | "years">("12m");

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { dividends: divMap, loading } = useDividends(histItems);

  const holdings = useMemo(
    () => summarizeAll(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );
  const holdingById = useMemo(
    () => new Map<string, HoldingSummary>(holdings.map((h) => [h.asset.id, h])),
    [holdings],
  );

  // Real payments per asset, scaled by shares held on each pay date.
  const perAsset = useMemo<AssetDividends[]>(() => {
    const fx = valuation.fx ?? {};
    const out: AssetDividends[] = [];
    for (const asset of data.assets) {
      const events = divMap[assetPriceKey(asset)];
      if (!events || events.length === 0) continue;
      const txs = transactionsByAsset(asset.id, data.transactions);
      const payments = dividendsFromEvents(events, txs);
      if (payments.length === 0) continue;
      const cur = asset.currency ?? currency;
      out.push({ asset, payments, rate: cur === currency ? 1 : (fx[cur] ?? 1) });
    }
    return out;
  }, [divMap, data.assets, data.transactions, currency, valuation]);

  const t12mStart = addDays(todayISO, -365);

  const stats = useMemo(() => {
    let allTime = 0;
    let t12m = 0;
    for (const { payments, rate } of perAsset) {
      for (const p of payments) {
        const v = p.total * rate;
        allTime += v;
        if (p.date >= t12mStart) t12m += v;
      }
    }
    let marketValue = 0;
    let costBasis = 0;
    for (const h of holdings) {
      marketValue += h.marketValue;
      costBasis += h.costBasis;
    }
    return {
      allTime,
      t12m,
      yield: marketValue > 0 ? t12m / marketValue : 0,
      yieldOnCost: costBasis > 0 ? t12m / costBasis : 0,
    };
  }, [perAsset, holdings, t12mStart]);

  // Income bars: trailing 12 months, or one bar per year all-time.
  const barData = useMemo(() => {
    if (range === "12m") {
      const byMonth = new Map<string, number>();
      for (const { payments, rate } of perAsset) {
        for (const p of payments) {
          if (p.date < t12mStart) continue;
          const key = p.date.slice(0, 7);
          byMonth.set(key, (byMonth.get(key) ?? 0) + p.total * rate);
        }
      }
      return trailingMonths(todayISO).map((m) => ({
        label: monthLabel(m),
        value: byMonth.get(m) ?? 0,
      }));
    }
    const byYear = new Map<string, number>();
    for (const { payments, rate } of perAsset) {
      for (const p of payments) {
        const key = p.date.slice(0, 4);
        byYear.set(key, (byYear.get(key) ?? 0) + p.total * rate);
      }
    }
    return [...byYear.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([year, value]) => ({ label: year, value }));
  }, [perAsset, range, t12mStart, todayISO]);

  // Per-holding rows, ranked by trailing-12-month income.
  const rows = useMemo(() => {
    return perAsset
      .map(({ asset, payments, rate }) => {
        let allTime = 0;
        let t12m = 0;
        for (const p of payments) {
          const v = p.total * rate;
          allTime += v;
          if (p.date >= t12mStart) t12m += v;
        }
        const h = holdingById.get(asset.id);
        return {
          asset,
          allTime,
          t12m,
          yield: h && h.marketValue > 0 ? t12m / h.marketValue : 0,
          yieldOnCost: h && h.costBasis > 0 ? t12m / h.costBasis : 0,
        };
      })
      .sort((a, b) => b.t12m - a.t12m);
  }, [perAsset, holdingById, t12mStart]);

  // Forecast: each payout of the trailing year, projected one year forward at
  // the CURRENT share count (per-share amount × shares held today).
  const forecast = useMemo(() => {
    const out: { date: string; asset: Asset; amount: number }[] = [];
    for (const { asset, payments, rate } of perAsset) {
      const shares = holdingById.get(asset.id)?.position.shares ?? 0;
      if (shares <= 0) continue;
      for (const p of payments) {
        if (p.date < t12mStart) continue;
        const [y, m, d] = p.date.split("-").map(Number);
        const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
        const date = new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastDay)))
          .toISOString()
          .slice(0, 10);
        if (date <= todayISO) continue;
        out.push({ date, asset, amount: p.perShare * shares * rate });
      }
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  }, [perAsset, holdingById, t12mStart, todayISO]);

  const forecastTotal = useMemo(() => forecast.reduce((s, f) => s + f.amount, 0), [forecast]);

  if (data.assets.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("div.addHoldings")}</p>
      </Card>
    );
  }

  const chartAriaLabel = t("div.chart.ariaLabel", {
    total: formatCurrency(
      barData.reduce((s, d) => s + d.value, 0),
      currency,
    ),
  });

  // Snug y-axis width from the actual tick extremes instead of a fixed guess.
  const formatBarValueTick = (v: number) => formatCurrency(v, currency);
  const barValueWidth = yAxisWidth(
    barData.length
      ? [Math.min(...barData.map((d) => d.value)), Math.max(...barData.map((d) => d.value))].map(
          formatBarValueTick,
        )
      : [],
  );

  // The portfolio is loaded (data.assets.length > 0 above) but the real
  // dividend events for it are still in flight — show placeholders instead of
  // the zero-value stats/chart/table that would otherwise flash before the
  // real numbers land. Nothing to wait for if there's nothing quotable.
  const showSkeleton = loading && histItems.length > 0;

  return (
    <div
      className="space-y-6"
      role={showSkeleton ? "status" : undefined}
      aria-busy={showSkeleton || undefined}
      aria-label={showSkeleton ? t("common.loading") : undefined}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <Card>
              <Stat
                label={t("div.received12m")}
                value={formatCurrency(stats.t12m, currency)}
                info={t("div.received12mTip")}
                isPrivate
              />
            </Card>
            <Card>
              <Stat
                label={t("div.receivedTotal")}
                value={formatCurrency(stats.allTime, currency)}
                info={t("div.receivedTotalTip")}
                isPrivate
              />
            </Card>
            <Card>
              <Stat
                label={t("div.yield")}
                value={formatPercent(stats.yield)}
                info={t("div.yieldTip")}
              />
            </Card>
            <Card>
              <Stat
                label={t("div.yieldOnCost")}
                value={formatPercent(stats.yieldOnCost)}
                info={t("div.yieldOnCostTip")}
              />
            </Card>
          </>
        )}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            {t("div.income")}
            <InfoTip text={t("div.incomeTip")} />
          </h2>
          <SegmentedControl
            size="sm"
            value={range}
            onChange={setRange}
            options={[
              { label: t("div.range12m"), value: "12m" as const },
              { label: t("div.rangeYears"), value: "years" as const },
            ]}
          />
        </div>
        {showSkeleton ? (
          <div className="mt-3">
            <Skeleton className="h-[260px] w-full rounded-lg" />
          </div>
        ) : barData.every((d) => d.value === 0) ? (
          <p className="mt-3 text-sm text-zinc-500">{t("div.none")}</p>
        ) : (
          <div className="mt-3" data-private role="img" aria-label={chartAriaLabel}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  minTickGap={16}
                  interval="preserveStartEnd"
                  stroke="currentColor"
                  className="text-zinc-400"
                />
                <YAxis
                  tickFormatter={(v) => formatBarValueTick(Number(v))}
                  width={barValueWidth}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-zinc-400"
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid rgba(120,120,120,0.3)", fontSize: 13 }}
                  formatter={(v) => [formatCurrency(Number(v), currency), t("div.dividends")]}
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]} fill={EMERALD} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            {t("div.byHolding")}
            <InfoTip text={t("div.byHoldingTip")} />
          </h2>
          {showSkeleton ? (
            <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {Array.from({ length: 5 }).map((_, i) => (
                <ListRowSkeleton key={i} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">{t("div.none")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <th className="py-2 pr-3 font-medium">{t("sp.asset")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t("div.col12m")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t("div.colTotal")}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t("div.colYield")}</th>
                    <th className="py-2 text-right font-medium">{t("div.colYoC")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.asset.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                    >
                      <td className="max-w-[14rem] py-2 pr-3">
                        <Link
                          href={`/assets/${r.asset.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {r.asset.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-private>
                        {formatCurrency(r.t12m, currency)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-private>
                        {formatCurrency(r.allTime, currency)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatPercent(r.yield)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatPercent(r.yieldOnCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">
              {t("div.forecast")}
              <InfoTip text={t("div.forecastTip")} />
            </h2>
            {forecast.length > 0 && (
              <span className="text-sm font-medium tabular-nums" data-private>
                {formatCurrency(forecastTotal, currency)}
              </span>
            )}
          </div>
          {showSkeleton ? (
            <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {Array.from({ length: 5 }).map((_, i) => (
                <ListRowSkeleton key={i} />
              ))}
            </div>
          ) : forecast.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">{t("div.none")}</p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {forecast.slice(0, 12).map((f, i) => (
                  <li key={`${f.asset.id}:${f.date}:${i}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{f.asset.name}</span>
                      <span className="block text-xs text-zinc-500">{formatDate(f.date)}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums" data-private>
                      ≈ {formatCurrency(f.amount, currency)}
                    </span>
                  </li>
                ))}
              </ul>
              {forecast.length > 12 && (
                <p className="mt-2 text-xs text-zinc-400">
                  {t("div.forecastMore", { count: forecast.length - 12 })}
                </p>
              )}
              <p className="mt-3 text-xs text-zinc-400">{t("div.forecastDisclaimer")}</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
