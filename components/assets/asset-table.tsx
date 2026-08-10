"use client";

// Asset table (PRD §4.2): name, current price, current value, entry price and
// portfolio allocation. Sortable + filterable; each row links to the detail
// page. Per-asset prices are in the native currency; value is in the base
// currency (so allocation is comparable across currencies).

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import {
  holdingPeriodProfit,
  summarizeAll,
  type HoldingSummary,
} from "@/lib/finance/portfolio";
import { dateKey, type Timeframe } from "@/lib/finance/dates";
import { formatCurrency, formatDate, formatNumber, formatPercent, plColor } from "@/lib/format";
import { assetIdentifier, type AssetType } from "@/lib/types";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useOwnerLabel } from "@/lib/household/use-owner-label";
import { AssetIdentifiers } from "@/components/ui/asset-identifiers";
import { Table, TablePagination, Tbody, Td, Th, Thead, Tr, usePagination } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { EstimatedBadge } from "@/components/ui/estimated-badge";

type SortKey = "name" | "owner" | "price" | "value" | "entry" | "profit" | "allocation";
type PastSortKey = "name" | "realizedPL" | "lastTransaction";

const TYPE_FILTERS: (AssetType | "ALL")[] = [
  "ALL",
  "ETF",
  "STOCK",
  "CRYPTO",
  "COMMODITY",
  "CASH",
  "OTHER",
];

/** Shares below this are treated as fully liquidated (float dust). */
const SHARE_EPS = 1e-9;

interface Row {
  h: HoldingSummary;
  allocation: number;
  /** entry (average purchase) price in the native currency. */
  entry: number;
  /** profit over the selected timeframe, base currency + fraction. */
  profit: { abs: number; pct: number };
}

export function AssetTable({ timeframe }: { timeframe: Timeframe }) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const { shared, label: ownerLabel } = useOwnerLabel();
  const currency = data.profile.currency;

  const allSummaries = useMemo(
    () => summarizeAll(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );

  const holdings = useMemo(
    () => allSummaries.filter((h) => h.position.shares > SHARE_EPS),
    [allSummaries],
  );

  const total = useMemo(
    () => holdings.reduce((s, h) => s + h.marketValue, 0),
    [holdings],
  );

  // Assets with a zero position but at least one transaction: fully
  // liquidated holdings, shown collapsed below the main table. Also track
  // each asset's most recent transaction day for that section.
  const { pastHoldings, lastTxDate } = useMemo(() => {
    const last = new Map<string, string>();
    for (const t of data.transactions) {
      const d = dateKey(t.date);
      const cur = last.get(t.assetId);
      if (!cur || d > cur) last.set(t.assetId, d);
    }
    const past = allSummaries.filter(
      (h) => h.position.shares <= SHARE_EPS && last.has(h.asset.id),
    );
    return { pastHoldings: past, lastTxDate: last };
  }, [allSummaries, data.transactions]);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "ALL">("ALL");
  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("value", "desc");

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const list = holdings
      .filter((h) => {
        if (typeFilter !== "ALL" && h.asset.type !== typeFilter) return false;
        if (!q) return true;
        return (
          h.asset.name.toLowerCase().includes(q) ||
          (h.asset.symbol ?? "").toLowerCase().includes(q) ||
          (h.asset.isin ?? "").toLowerCase().includes(q) ||
          (h.asset.wkn ?? "").toLowerCase().includes(q)
        );
      })
      .map((h) => ({
        h,
        allocation: total > 0 ? h.marketValue / total : 0,
        entry: h.position.avgCost,
        profit: holdingPeriodProfit(h.asset, data.transactions, timeframe, valuation),
      }));
    return applySort(list, (r, key) => {
      if (key === "name") return r.h.asset.name;
      if (key === "owner") return ownerLabel(r.h.asset.ownerId) ?? "";
      // CASH has no per-unit price — sort by what's actually displayed (the
      // position's total value) instead of the constant 1.
      if (key === "price") return r.h.asset.type === "CASH" ? r.h.marketValue : r.h.price;
      if (key === "entry") return r.entry;
      if (key === "value") return r.h.marketValue;
      if (key === "profit") return r.profit.abs;
      return r.allocation;
    });
  }, [holdings, query, typeFilter, applySort, total, data.transactions, timeframe, valuation, ownerLabel]);

  const pager = usePagination(rows);

  const pastSort = useSort<PastSortKey>("name");
  const sortedPastHoldings = useMemo(
    () =>
      pastSort.apply(pastHoldings, (h, key) => {
        if (key === "name") return h.asset.name;
        if (key === "realizedPL") return h.realizedPL;
        return lastTxDate.get(h.asset.id) ?? null;
      }),
    [pastHoldings, pastSort, lastTxDate],
  );
  const pastPager = usePagination(sortedPastHoldings);

  if (data.assets.length === 0) return null;

  return (
    <>
    <div data-tour="holdings" className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">{t("table.holdings")}</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("table.filter")}
          className="ml-auto w-full max-w-xs rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <div className="flex gap-1">
          {TYPE_FILTERS.map((_t) => (
            <button
              key={_t}
              onClick={() => setTypeFilter(_t)}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
                typeFilter === _t
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {t(`assetType.${_t}`)}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-sm text-zinc-500">{t("table.noMatch")}</p>
      ) : (
        <>
        {/* Mobile: stacked cards (the wide table is hidden below md). */}
        <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800/60">
          {pager.rows.map(({ h, allocation, entry, profit }) => {
            const nativeCur = h.currency || currency;
            const isCash = h.asset.type === "CASH";
            const gain = h.price - entry;
            return (
              <li key={h.asset.id}>
                <Link
                  href={`/assets/${h.asset.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 active:bg-zinc-50 dark:active:bg-zinc-800/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{h.asset.name}</div>
                    {shared && ownerLabel(h.asset.ownerId) && (
                      <div className="mt-0.5 truncate text-xs text-zinc-500">
                        {ownerLabel(h.asset.ownerId)}
                      </div>
                    )}
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {isCash ? (
                        <>
                          {assetIdentifier(h.asset)} ·{" "}
                          <span data-private>{formatCurrency(h.marketValue, currency)}</span>
                        </>
                      ) : (
                        <>
                          {assetIdentifier(h.asset)} · {formatCurrency(h.price, nativeCur)}
                          {h.syntheticPrice && <EstimatedBadge compact tip={t("data.estimatedPriceTip")} />}
                          {entry > 0 && (
                            <span className={`ml-1 ${plColor(gain)}`}>
                              {formatPercent(gain / entry)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-medium tabular-nums" data-private>
                      {formatCurrency(h.marketValue, currency)}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                      {formatNumber(allocation * 100, 1)}%
                      <span className={`ml-1 ${plColor(profit.abs)}`}>
                        {formatPercent(profit.pct)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Desktop: full sortable table. */}
        <Table className="hidden md:block" ariaLabel={t("table.holdings")}>
          <Thead>
            <Th sort={sort} sortKey="name" onSort={toggleSort}>
              {t("table.name")}
            </Th>
            {shared && (
              <Th sort={sort} sortKey="owner" onSort={toggleSort}>
                {t("table.owner")}
              </Th>
            )}
            <Th align="right" sort={sort} sortKey="price" onSort={toggleSort}>
              {t("table.currentPrice")}
            </Th>
            <Th align="right" sort={sort} sortKey="entry" onSort={toggleSort}>
              {t("table.entryPrice")}
            </Th>
            <Th align="right" sort={sort} sortKey="value" onSort={toggleSort}>
              {t("table.currentValue")}
            </Th>
            <Th align="right" sort={sort} sortKey="profit" onSort={toggleSort}>
              {`${t("table.profit")} (${timeframe})`}
            </Th>
            <Th align="right" sort={sort} sortKey="allocation" onSort={toggleSort}>
              {t("table.allocation")}
            </Th>
          </Thead>
          <Tbody>
            {pager.rows.map(({ h, allocation, entry, profit }) => {
              const nativeCur = h.currency || currency;
              const isCash = h.asset.type === "CASH";
              const gain = h.price - entry;
              return (
                <Tr key={h.asset.id}>
                  <Td>
                    <Link href={`/assets/${h.asset.id}`} className="font-medium hover:underline">
                      {h.asset.name}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      <AssetIdentifiers asset={h.asset} />
                    </div>
                  </Td>
                  {shared && (
                    <Td className="text-zinc-500">{ownerLabel(h.asset.ownerId) ?? "—"}</Td>
                  )}
                  <Td align="right" className="tabular-nums" {...(isCash ? { "data-private": "" } : {})}>
                    {isCash ? (
                      formatCurrency(h.marketValue, currency)
                    ) : (
                      <>
                        {formatCurrency(h.price, nativeCur)}
                        {h.syntheticPrice && <EstimatedBadge compact tip={t("data.estimatedPriceTip")} />}
                        {entry > 0 && (
                          <span className={`ml-1 text-xs ${plColor(gain)}`}>
                            ({formatPercent(gain / entry)})
                          </span>
                        )}
                      </>
                    )}
                  </Td>
                  <Td align="right" className="tabular-nums text-zinc-500" data-private>
                    {isCash ? "—" : formatCurrency(entry, nativeCur)}
                  </Td>
                  <Td align="right" className="font-medium tabular-nums" data-private>
                    {formatCurrency(h.marketValue, currency)}
                  </Td>
                  <Td align="right" className={`tabular-nums ${plColor(profit.abs)}`} data-private>
                    {profit.abs >= 0 ? "+" : ""}
                    {formatCurrency(profit.abs, currency)}
                    <span className="ml-1 text-xs opacity-80">({formatPercent(profit.pct)})</span>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100 sm:block dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.min(100, allocation * 100)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums">
                        {formatNumber(allocation * 100, 1)}%
                      </span>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
        <div className="px-4 pb-4">
          <TablePagination pager={pager} />
        </div>
        </>
      )}
    </div>

    {pastHoldings.length > 0 && (
      <details className="group mt-4 rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-4 text-lg font-semibold marker:content-none">
          <span className="inline-block text-sm transition-transform group-open:rotate-90">
            ›
          </span>
          {t("table.pastHoldings")}{" "}
          <span className="font-normal text-zinc-400">({pastHoldings.length})</span>
        </summary>
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <Table ariaLabel={t("table.pastHoldings")}>
            <Thead>
              <Th sort={pastSort.sort} sortKey="name" onSort={pastSort.toggle}>
                {t("table.name")}
              </Th>
              <Th align="right" sort={pastSort.sort} sortKey="realizedPL" onSort={pastSort.toggle}>
                {t("stat.realized")}
              </Th>
              <Th
                align="right"
                sort={pastSort.sort}
                sortKey="lastTransaction"
                onSort={pastSort.toggle}
              >
                {t("table.lastTransaction")}
              </Th>
            </Thead>
            <Tbody>
              {pastPager.rows.map((h) => (
                <Tr key={h.asset.id}>
                  <Td>
                    <Link href={`/assets/${h.asset.id}`} className="font-medium hover:underline">
                      {h.asset.name}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      <AssetIdentifiers asset={h.asset} />
                    </div>
                  </Td>
                  <Td align="right" className={`tabular-nums ${plColor(h.realizedPL)}`} data-private>
                    {h.realizedPL >= 0 ? "+" : ""}
                    {formatCurrency(h.realizedPL, currency)}
                  </Td>
                  <Td align="right" className="tabular-nums text-zinc-500">
                    {formatDate(lastTxDate.get(h.asset.id) ?? "")}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <div className="px-4 pb-4">
            <TablePagination pager={pastPager} />
          </div>
        </div>
      </details>
    )}
    </>
  );
}
