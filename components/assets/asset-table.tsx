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
import { AssetIdentifiers } from "@/components/ui/asset-identifiers";
import { EstimatedBadge } from "@/components/ui/estimated-badge";

type SortKey = "name" | "price" | "value" | "entry" | "profit" | "allocation";

const TYPE_FILTERS: (AssetType | "ALL")[] = ["ALL", "ETF", "STOCK", "CRYPTO", "CASH"];

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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "value",
    dir: -1,
  });

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
    return list.sort((a, b) => compare(a, b, sort.key) * sort.dir);
  }, [holdings, query, typeFilter, sort, total, data.transactions, timeframe, valuation]);

  if (data.assets.length === 0) return null;

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 },
    );
  }

  return (
    <>
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">{t("table.holdings")}</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("table.filter")}
          className="ml-auto w-full max-w-xs rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <div className="flex gap-1">
          {TYPE_FILTERS.map((_t) => (
            <button
              key={_t}
              onClick={() => setTypeFilter(_t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
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
          {rows.map(({ h, allocation, entry, profit }) => {
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
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {isCash ? (
                        assetIdentifier(h.asset)
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
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <Th label={t("table.name")} k="name" sort={sort} onSort={toggleSort} />
                <Th label={t("table.currentPrice")} k="price" sort={sort} onSort={toggleSort} align="right" />
                <Th label={t("table.entryPrice")} k="entry" sort={sort} onSort={toggleSort} align="right" />
                <Th label={t("table.currentValue")} k="value" sort={sort} onSort={toggleSort} align="right" />
                <Th label={`${t("table.profit")} (${timeframe})`} k="profit" sort={sort} onSort={toggleSort} align="right" />
                <Th label={t("table.allocation")} k="allocation" sort={sort} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, allocation, entry, profit }) => {
                const nativeCur = h.currency || currency;
                const isCash = h.asset.type === "CASH";
                const gain = h.price - entry;
                return (
                  <tr
                    key={h.asset.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/assets/${h.asset.id}`} className="font-medium hover:underline">
                        {h.asset.name}
                      </Link>
                      <div className="text-xs text-zinc-500">
                        <AssetIdentifiers asset={h.asset} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {isCash ? (
                        <span className="text-zinc-400">—</span>
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
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500" data-private>
                      {isCash ? "—" : formatCurrency(entry, nativeCur)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums" data-private>
                      {formatCurrency(h.marketValue, currency)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${plColor(profit.abs)}`} data-private>
                      {profit.abs >= 0 ? "+" : ""}
                      {formatCurrency(profit.abs, currency)}
                      <span className="ml-1 text-xs opacity-80">({formatPercent(profit.pct)})</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>

    {pastHoldings.length > 0 && (
      <details className="group mt-4 rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-4 text-lg font-semibold marker:content-none">
          <span className="inline-block text-sm transition-transform group-open:rotate-90">
            ›
          </span>
          {t("table.pastHoldings")}{" "}
          <span className="font-normal text-zinc-400">({pastHoldings.length})</span>
        </summary>
        <div className="overflow-x-auto border-t border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2 font-medium">{t("table.name")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("stat.realized")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("table.lastTransaction")}</th>
              </tr>
            </thead>
            <tbody>
              {pastHoldings.map((h) => (
                <tr
                  key={h.asset.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-4 py-3">
                    <Link href={`/assets/${h.asset.id}`} className="font-medium hover:underline">
                      {h.asset.name}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      <AssetIdentifiers asset={h.asset} />
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${plColor(h.realizedPL)}`} data-private>
                    {h.realizedPL >= 0 ? "+" : ""}
                    {formatCurrency(h.realizedPL, currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                    {formatDate(lastTxDate.get(h.asset.id) ?? "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    )}
    </>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        <span className="text-[10px]">{active ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "name":
      return a.h.asset.name.localeCompare(b.h.asset.name);
    case "price":
      return a.h.price - b.h.price;
    case "entry":
      return a.entry - b.entry;
    case "value":
      return a.h.marketValue - b.h.marketValue;
    case "profit":
      return a.profit.abs - b.profit.abs;
    case "allocation":
      return a.allocation - b.allocation;
  }
}
