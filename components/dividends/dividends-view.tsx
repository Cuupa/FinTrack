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
import { useAnnouncedDividends } from "@/lib/history/use-announced-dividends";
import {
  dividendsFromEvents,
  projectDividends,
  applyAnnouncedDate,
  type DividendPayment,
} from "@/lib/finance/dividends";
import { useFeatureFlag } from "@/lib/flags/flags-context";
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
  const calendarEnabled = useFeatureFlag("dividendCalendar");
  const announced = useAnnouncedDividends(histItems, calendarEnabled);

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

  // Upcoming dividends: each per-share event of the trailing year, projected
  // one year forward at the CURRENT share count. Deliberately independent of
  // received payments — a holding bought today still forecasts its trailing
  // cadence. Enriched with the announced calendar (F4) where Yahoo has it: the
  // next projected payment adopts the confirmed pay date + ex-date and is
  // flagged `confirmed`; everything else stays a projection with no ex-date.
  const upcoming = useMemo(() => {
    const fx = valuation.fx ?? {};
    const out: {
      date: string;
      exDate: string | null;
      asset: Asset;
      amount: number;
      confirmed: boolean;
    }[] = [];
    for (const asset of data.assets) {
      const key = assetPriceKey(asset);
      const events = divMap[key];
      if (!events || events.length === 0) continue;
      const shares = holdingById.get(asset.id)?.position.shares ?? 0;
      if (shares <= 0) continue;
      const cur = asset.currency ?? currency;
      const rate = cur === currency ? 1 : (fx[cur] ?? 1);
      const projected = projectDividends(events, shares, t12mStart, todayISO);
      const ann = announced[key];
      const exDate = ann?.exDate && ann.exDate >= todayISO ? ann.exDate : null;
      for (const p of applyAnnouncedDate(projected, ann?.payDate ?? null, todayISO)) {
        out.push({
          date: p.date,
          exDate: p.confirmed ? exDate : null,
          asset,
          amount: p.amount * rate,
          confirmed: p.confirmed,
        });
      }
    }
    return out;
  }, [data.assets, divMap, announced, holdingById, currency, valuation, t12mStart, todayISO]);

  const upcomingTotal = useMemo(() => upcoming.reduce((s, f) => s + f.amount, 0), [upcoming]);

  const [upSort, setUpSort] = useState<{ key: "asset" | "ex" | "pay" | "amount"; dir: 1 | -1 }>({
    key: "pay",
    dir: 1,
  });
  const toggleUpSort = (key: "asset" | "ex" | "pay" | "amount") =>
    setUpSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "amount" ? -1 : 1 },
    );
  const sortedUpcoming = useMemo(() => {
    const rows = [...upcoming];
    return rows.sort((a, b) => {
      if (upSort.key === "amount") return (a.amount - b.amount) * upSort.dir;
      let va: string;
      let vb: string;
      if (upSort.key === "asset") {
        va = a.asset.name.toLowerCase();
        vb = b.asset.name.toLowerCase();
      } else if (upSort.key === "ex") {
        // Projected rows (no ex-date) sort to the end.
        va = a.exDate ?? "9999-99-99";
        vb = b.exDate ?? "9999-99-99";
      } else {
        va = a.date;
        vb = b.date;
      }
      if (va < vb) return -1 * upSort.dir;
      if (va > vb) return 1 * upSort.dir;
      return 0;
    });
  }, [upcoming, upSort]);

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
  // dividend events for it are still in flight, show placeholders instead of
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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            {t("div.upcoming")}
            <InfoTip text={t("div.upcomingTip")} />
          </h2>
          {upcoming.length > 0 && (
            <span className="text-sm font-medium tabular-nums" data-private>
              {formatCurrency(upcomingTotal, currency)}
            </span>
          )}
        </div>
        {showSkeleton ? (
          <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </div>
        ) : sortedUpcoming.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("div.none")}</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <UpTh label={t("sp.asset")} k="asset" sort={upSort} onSort={toggleUpSort} />
                    <UpTh label={t("div.exDate")} k="ex" sort={upSort} onSort={toggleUpSort} />
                    <UpTh label={t("div.payDate")} k="pay" sort={upSort} onSort={toggleUpSort} />
                    <UpTh
                      label={t("sp.amount")}
                      k="amount"
                      align="right"
                      sort={upSort}
                      onSort={toggleUpSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedUpcoming.map((f, i) => (
                    <tr
                      key={`${f.asset.id}:${f.date}:${i}`}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="max-w-[16rem] py-2 pr-3">
                        <Link
                          href={`/assets/${f.asset.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {f.asset.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {f.exDate ? formatDate(f.exDate) : <span className="text-zinc-400">–</span>}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatDate(f.date)}
                        {f.confirmed && (
                          <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">
                            {t("div.confirmedDate")}
                          </span>
                        )}
                      </td>
                      {/* The amount is always a projection from last year's
                          payout; only the DATE is ever confirmed, so the ≈
                          stays on every row. */}
                      <td className="py-2 text-right tabular-nums" data-private>
                        ≈ {formatCurrency(f.amount, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-zinc-400">{t("div.forecastDisclaimer")}</p>
          </>
        )}
      </Card>

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
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
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
    </div>
  );
}

type UpSortKey = "asset" | "ex" | "pay" | "amount";

function UpTh({
  label,
  k,
  align,
  sort,
  onSort,
}: {
  label: string;
  k: UpSortKey;
  align?: "right";
  sort: { key: UpSortKey; dir: 1 | -1 };
  onSort: (k: UpSortKey) => void;
}) {
  return (
    <th className={`py-2 pr-3 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {label}
        <span className="text-[10px]">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}
