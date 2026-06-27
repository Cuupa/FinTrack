"use client";

// Asset table (PRD §4.2): name, current price, current value, entry price and
// portfolio allocation. Sortable + filterable; each row links to the detail
// page. Per-asset prices are in the native currency; value is in the base
// currency (so allocation is comparable across currencies).

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { summarizeAll, type HoldingSummary } from "@/lib/finance/portfolio";
import { formatCurrency, formatNumber, formatPercent, plColor } from "@/lib/format";
import { assetIdentifier, type AssetType } from "@/lib/types";

type SortKey = "name" | "price" | "value" | "entry" | "allocation";

const TYPE_FILTERS: (AssetType | "ALL")[] = ["ALL", "ETF", "STOCK", "CRYPTO", "CASH"];

interface Row {
  h: HoldingSummary;
  allocation: number;
  /** entry (average purchase) price in the native currency. */
  entry: number;
}

export function AssetTable() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const currency = data.profile.currency;

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  const total = useMemo(
    () => holdings.reduce((s, h) => s + h.marketValue, 0),
    [holdings],
  );

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
      }));
    return list.sort((a, b) => compare(a, b, sort.key) * sort.dir);
  }, [holdings, query, typeFilter, sort, total]);

  if (data.assets.length === 0) return null;

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 },
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Holdings</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, symbol, ISIN, WKN…"
          className="ml-auto w-full max-w-xs rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <div className="flex gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                typeFilter === t
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-sm text-zinc-500">No holdings match your filter.</p>
      ) : (
        <>
        {/* Mobile: stacked cards (the wide table is hidden below md). */}
        <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800/60">
          {rows.map(({ h, allocation, entry }) => {
            const nativeCur = h.currency || currency;
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
                      {assetIdentifier(h.asset)} · {formatCurrency(h.price, nativeCur)}
                      {entry > 0 && (
                        <span className={`ml-1 ${plColor(gain)}`}>
                          {formatPercent(gain / entry)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-medium tabular-nums">
                      {formatCurrency(h.marketValue, currency)}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500 tabular-nums">
                      {formatNumber(allocation * 100, 1)}%
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
                <Th label="Name" k="name" sort={sort} onSort={toggleSort} />
                <Th label="Current price" k="price" sort={sort} onSort={toggleSort} align="right" />
                <Th label="Entry price" k="entry" sort={sort} onSort={toggleSort} align="right" />
                <Th label="Current value" k="value" sort={sort} onSort={toggleSort} align="right" />
                <Th label="Allocation" k="allocation" sort={sort} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, allocation, entry }) => {
                const nativeCur = h.currency || currency;
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
                      <div className="text-xs text-zinc-500">{assetIdentifier(h.asset)}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(h.price, nativeCur)}
                      {entry > 0 && (
                        <span className={`ml-1 text-xs ${plColor(gain)}`}>
                          ({formatPercent(gain / entry)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                      {formatCurrency(entry, nativeCur)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCurrency(h.marketValue, currency)}
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
    case "allocation":
      return a.allocation - b.allocation;
  }
}
