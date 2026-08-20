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
import { Card, SectionTitle, SegmentedControl, Stat, StatRow } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { StatSkeleton, ListRowSkeleton } from "@/components/dividends/dividends-skeleton";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Table, TablePagination, Tbody, Td, Th, Thead, Tr, usePagination } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { yAxisWidth } from "@/components/charts/axis";
import { intlLocale } from "@/lib/i18n/locale";

const EMERALD = "#10b981";

interface AssetDividends {
  asset: Asset;
  /** Payments in the asset's currency. */
  payments: DividendPayment[];
  /** Native → base rate. */
  rate: number;
}

type HoldingSortKey = "asset" | "t12m" | "allTime" | "yield" | "yieldOnCost";
type UpSortKey = "asset" | "ex" | "pay" | "amount";

/** "2025-01" → "Jan '25" in the active locale. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mon = new Intl.DateTimeFormat(intlLocale(), { month: "short" }).format(new Date(y, m - 1, 1));
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

  // Per-holding rows, ranked by trailing-12-month income by default.
  const holdingSort = useSort<HoldingSortKey>("t12m", "desc");
  const rows = useMemo(() => {
    const list = perAsset.map(({ asset, payments, rate }) => {
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
    });
    return holdingSort.apply(list, (r, key) => {
      if (key === "asset") return r.asset.name;
      if (key === "t12m") return r.t12m;
      if (key === "allTime") return r.allTime;
      if (key === "yield") return r.yield;
      return r.yieldOnCost;
    });
  }, [perAsset, holdingById, t12mStart, holdingSort]);

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

  const upSort = useSort<UpSortKey>("pay");
  const sortedUpcoming = useMemo(
    () =>
      upSort.apply(upcoming, (r, key) => {
        if (key === "amount") return r.amount;
        if (key === "asset") return r.asset.name;
        // Projected rows (no ex-date) sort to the end.
        if (key === "ex") return r.exDate;
        return r.date;
      }),
    [upcoming, upSort],
  );

  const upcomingPager = usePagination(sortedUpcoming);
  const holdingsPager = usePagination(rows);

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
      <StatRow cols={4} data-tour="dividends-kpis">
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <Stat
              label={t("div.received12m")}
              value={formatCurrency(stats.t12m, currency)}
              isPrivate
              info={t("div.received12mTip")}
            />
            <Stat
              label={t("div.receivedTotal")}
              value={formatCurrency(stats.allTime, currency)}
              isPrivate
              info={t("div.receivedTotalTip")}
            />
            <Stat
              label={t("div.yield")}
              value={formatPercent(stats.yield)}
              info={t("div.yieldTip")}
            />
            <Stat
              label={t("div.yieldOnCost")}
              value={formatPercent(stats.yieldOnCost)}
              info={t("div.yieldOnCostTip")}
            />
          </>
        )}
      </StatRow>

      <Card data-tour="dividends-income">
        <SectionTitle
          info={t("div.incomeTip")}
          actions={
            <SegmentedControl
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { label: t("div.range12m"), value: "12m" as const },
                { label: t("div.rangeYears"), value: "years" as const },
              ]}
            />
          }
        >
          {t("div.income")}
        </SectionTitle>
        {showSkeleton ? (
          <div className="mt-3">
            <Skeleton className="h-[260px] w-full rounded-md" />
          </div>
        ) : barData.every((d) => d.value === 0) ? (
          <p className="mt-3 text-sm text-zinc-500">{t("div.none")}</p>
        ) : (
          <div className="mt-3" data-private-axis role="img" aria-label={chartAriaLabel}>
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

      <Card data-tour="dividends-upcoming">
        <SectionTitle
          info={t("div.upcomingTip")}
          actions={
            upcoming.length > 0 ? (
              <span className="text-sm font-medium tabular-nums" data-private>
                {formatCurrency(upcomingTotal, currency)}
              </span>
            ) : undefined
          }
        >
          {t("div.upcoming")}
        </SectionTitle>
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
            <Table className="mt-3" ariaLabel={t("div.upcoming")}>
              <Thead>
                <Th sort={upSort.sort} sortKey="asset" onSort={upSort.toggle}>
                  {t("sp.asset")}
                </Th>
                <Th sort={upSort.sort} sortKey="ex" onSort={upSort.toggle}>
                  {t("div.exDate")}
                </Th>
                <Th sort={upSort.sort} sortKey="pay" onSort={upSort.toggle}>
                  {t("div.payDate")}
                </Th>
                <Th align="right" sort={upSort.sort} sortKey="amount" onSort={upSort.toggle}>
                  {t("sp.amount")}
                </Th>
              </Thead>
              <Tbody>
                {upcomingPager.rows.map((f, i) => (
                  <Tr key={`${f.asset.id}:${f.date}:${i}`}>
                    <Td className="max-w-[16rem]">
                      <Link
                        href={`/assets/${f.asset.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {f.asset.name}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">
                      {f.exDate ? formatDate(f.exDate) : <span className="text-zinc-400">–</span>}
                    </Td>
                    <Td className="tabular-nums">
                      {formatDate(f.date)}
                      {f.confirmed && (
                        <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">
                          {t("div.confirmedDate")}
                        </span>
                      )}
                    </Td>
                    {/* The amount is always a projection from last year's
                        payout; only the DATE is ever confirmed, so the ≈
                        stays on every row. */}
                    <Td align="right" className="tabular-nums" data-private>
                      ≈ {formatCurrency(f.amount, currency)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <TablePagination pager={upcomingPager} />
            <p className="mt-3 text-xs text-zinc-400">{t("div.forecastDisclaimer")}</p>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle info={t("div.byHoldingTip")}>{t("div.byHolding")}</SectionTitle>
        {showSkeleton ? (
          <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("div.none")}</p>
        ) : (
          <>
            <Table className="mt-3" ariaLabel={t("div.byHolding")}>
              <Thead>
                <Th sort={holdingSort.sort} sortKey="asset" onSort={holdingSort.toggle}>
                  {t("sp.asset")}
                </Th>
                <Th align="right" sort={holdingSort.sort} sortKey="t12m" onSort={holdingSort.toggle}>
                  {t("div.col12m")}
                </Th>
                <Th align="right" sort={holdingSort.sort} sortKey="allTime" onSort={holdingSort.toggle}>
                  {t("div.colTotal")}
                </Th>
                <Th align="right" sort={holdingSort.sort} sortKey="yield" onSort={holdingSort.toggle}>
                  {t("div.colYield")}
                </Th>
                <Th
                  align="right"
                  sort={holdingSort.sort}
                  sortKey="yieldOnCost"
                  onSort={holdingSort.toggle}
                >
                  {t("div.colYoC")}
                </Th>
              </Thead>
              <Tbody>
                {holdingsPager.rows.map((r) => (
                  <Tr key={r.asset.id}>
                    <Td className="max-w-[14rem]">
                      <Link
                        href={`/assets/${r.asset.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {r.asset.name}
                      </Link>
                    </Td>
                    <Td align="right" className="tabular-nums" data-private>
                      {formatCurrency(r.t12m, currency)}
                    </Td>
                    <Td align="right" className="tabular-nums" data-private>
                      {formatCurrency(r.allTime, currency)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatPercent(r.yield)}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatPercent(r.yieldOnCost)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <TablePagination pager={holdingsPager} />
          </>
        )}
      </Card>
    </div>
  );
}
