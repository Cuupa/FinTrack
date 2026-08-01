"use client";

// Price health table: every row in the global `instruments` catalog (world-
// readable, read straight from the browser client — same RLS policy /api/catalog
// uses, but that route drops `id`, which this page needs for the revalidate
// action, so it queries the table directly instead of going through it).
//
// Staleness bands come from the pure lib/admin/price-health.ts helper (unit
// tested in tests/price-health.test.ts) so the classification logic isn't
// buried in JSX. A row with no `last_price` at all means the app is pricing
// it synthetically (see lib/finance/prices.ts) — reuses the existing
// EstimatedBadge rather than inventing a second "no real data" indicator.
//
// Revalidate (per-row and "all") posts to POST /api/admin/prices/revalidate;
// see that route for the self-heal semantics (null + re-resolve for STOCK/
// ETF, leave COMMODITY's authoritative hint alone, ?revalidate=1 for the
// bulk sweep).
//
// The base-currency and FX-rate columns mirror the finance core's own
// native->base conversion: `rateFor` in lib/finance/portfolio.ts multiplies
// a native price by `ValuationContext.fx[nativeCurrency]` (1 unit of that
// currency expressed in the base currency), falling back to 1 for the base
// currency itself or a currency with no rate loaded. `useLivePrices()`'s
// `valuation.fx` is exactly that map (built by `fxToBase` in
// lib/catalog/catalog.ts), so the same `fx[currency] ?? 1` multiplier is
// used here rather than re-deriving a rate.

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import {
  Table,
  TablePagination,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  usePagination,
} from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency, formatInstant } from "@/lib/format";
import { intlLocale } from "@/lib/i18n/locale";
import { priceStaleness, needsAttention, type PriceStaleness } from "@/lib/admin/price-health";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { InfoTip } from "@/components/ui/info-tip";
import { adminAuthToken, adminPost } from "@/lib/admin/client";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import type { AssetType } from "@/lib/types";

interface InstrumentRow {
  id: string;
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: AssetType;
  currency: string | null;
  quote_source: string | null;
  quote_id: string | null;
  last_price: number | string | null;
  price_synced_at: string | null;
  price_failed_at?: string | null;
  price_fail_count?: number | null;
}

type SortKey = "name" | "type" | "price" | "priceBase" | "fxRate" | "synced" | "retries";

const STALENESS_CLASS: Record<PriceStaleness, string> = {
  fresh:
    "border-emerald-400/60 bg-emerald-100 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-900/40 dark:text-emerald-200",
  stale:
    "border-amber-400/60 bg-amber-100 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-200",
  dead: "border-red-400/60 bg-red-100 text-red-800 dark:border-red-700/60 dark:bg-red-900/40 dark:text-red-200",
  unknown:
    "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function StalenessBadge({ status, label }: { status: PriceStaleness; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STALENESS_CLASS[status]}`}
    >
      {label}
    </span>
  );
}

function identifier(r: InstrumentRow): string {
  return r.isin ?? r.wkn ?? r.symbol ?? "";
}

export default function AdminPricesPage() {
  const { t } = useI18n();
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const base = data.profile.currency;
  // valuation.fx is a fresh object every render when absent; stabilize the
  // fallback so it doesn't retrigger the `filtered` useMemo below every time.
  const fx = useMemo(() => valuation.fx ?? {}, [valuation.fx]);
  const [rows, setRows] = useState<InstrumentRow[] | null>(null);
  const [rowsVersion, setRowsVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const sort = useSort<SortKey>("synced");
  const [revalidating, setRevalidating] = useState<Set<string>>(new Set());
  const [revalidatingAll, setRevalidatingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("instruments")
      // `*`: naming the migration-0114 columns would make PostgREST reject the
      // whole query on a database that has not run it yet, and the page would
      // show an empty catalog instead of a missing column.
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (!active) return;
        setRows((data ?? []) as InstrumentRow[]);
      });
    return () => {
      active = false;
    };
  }, [rowsVersion]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (rows ?? []).filter((r) => {
      if (staleOnly && !needsAttention(numOrNull(r.last_price), r.price_synced_at)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.isin ?? "").toLowerCase().includes(q) ||
        (r.wkn ?? "").toLowerCase().includes(q) ||
        (r.symbol ?? "").toLowerCase().includes(q) ||
        (r.quote_id ?? "").toLowerCase().includes(q)
      );
    });
    return sort.apply(list, (r, key) => sortValue(r, key, base, fx));
  }, [rows, query, staleOnly, sort, base, fx]);


  // Same 25-row paging as every other table in the app.
  const pager = usePagination(filtered);

  const revalidateOne = async (id: string) => {
    setError(null);
    setRevalidating((s) => new Set(s).add(id));
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost("/api/admin/prices/revalidate", { instrumentId: id }, token);
      setRowsVersion((v) => v + 1);
    } catch {
      setError(t("admin.prices.error"));
    } finally {
      setRevalidating((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const revalidateAll = async () => {
    setError(null);
    setRevalidatingAll(true);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost("/api/admin/prices/revalidate", {}, token);
      setRowsVersion((v) => v + 1);
    } catch {
      setError(t("admin.prices.error"));
    } finally {
      setRevalidatingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.prices.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.prices.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.prices.filterPlaceholder")}
            className="w-full max-w-xs rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={staleOnly}
              onChange={(e) => setStaleOnly(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            {t("admin.prices.staleOnly")}
          </label>
          <Button
            variant="primary"
            className="ml-auto"
            onClick={revalidateAll}
            disabled={revalidatingAll}
          >
            {revalidatingAll ? t("admin.prices.revalidating") : t("admin.prices.revalidateAll")}
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          {rows === null ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {rows.length === 0 ? t("admin.prices.empty") : t("admin.prices.noMatch")}
            </p>
          ) : (
            <>
            <Table>
              <Thead>
                <Th sort={sort.sort} sortKey="name" onSort={sort.toggle}>
                  {t("admin.prices.colName")}
                </Th>
                <Th sort={sort.sort} sortKey="type" onSort={sort.toggle}>
                  {t("admin.prices.colType")}
                </Th>
                <Th>{t("admin.prices.colQuote")}</Th>
                <Th align="right" sort={sort.sort} sortKey="price" onSort={sort.toggle}>
                  {t("admin.prices.colPrice")}
                </Th>
                <Th align="right" sort={sort.sort} sortKey="priceBase" onSort={sort.toggle}>
                  {t("admin.prices.colPriceBase")}
                </Th>
                <Th align="right" sort={sort.sort} sortKey="fxRate" onSort={sort.toggle}>
                  {t("admin.prices.colFxRate")}
                </Th>
                <Th sort={sort.sort} sortKey="synced" onSort={sort.toggle}>
                  {t("admin.prices.colSynced")}
                </Th>
                <Th
                  align="right"
                  sort={sort.sort}
                  sortKey="retries"
                  onSort={sort.toggle}
                  after={<InfoTip text={t("admin.prices.retriesTip")} />}
                >
                  {t("admin.prices.colRetries")}
                </Th>
                <Th />
              </Thead>
              <Tbody>
                {pager.rows.map((r) => {
                  const lastPrice = numOrNull(r.last_price);
                  const status = priceStaleness(r.price_synced_at);
                  const isRevalidating = revalidating.has(r.id);
                  const nativeCur = r.currency ?? "EUR";
                  const rate = rateForRow(r, base, fx);
                  const basePrice = lastPrice != null ? lastPrice * rate : null;
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-zinc-500">{identifier(r)}</div>
                      </Td>
                      <Td className="text-zinc-500">{t(`assetType.${r.type}`)}</Td>
                      <Td className="font-mono text-xs text-zinc-500">
                        {r.quote_source ?? "—"}
                        {r.quote_id ? `:${r.quote_id}` : ""}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {lastPrice != null ? (
                          formatCurrency(lastPrice, nativeCur)
                        ) : (
                          <EstimatedBadge compact tip={t("admin.prices.syntheticTip")} />
                        )}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {basePrice != null ? formatCurrency(basePrice, base) : "—"}
                      </Td>
                      <Td align="right" className="tabular-nums text-zinc-500">
                        {lastPrice != null ? formatRate(rate) : "—"}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <StalenessBadge status={status} label={t(`admin.prices.staleness.${status}`)} />
                          {r.price_synced_at && (
                            <span className="text-xs text-zinc-500">
                              {formatInstant(r.price_synced_at)}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {r.price_fail_count && r.price_fail_count > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {r.price_fail_count}
                            {r.price_failed_at && (
                              <span className="ml-2 text-xs text-zinc-500">
                                {formatInstant(r.price_failed_at)}
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td align="right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => revalidateOne(r.id)}
                          disabled={isRevalidating}
                        >
                          {isRevalidating
                            ? t("admin.prices.revalidating")
                            : t("admin.prices.revalidate")}
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
            <TablePagination pager={pager} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/** FX rate at a fixed 4 decimals (e.g. "1.0000" for the same currency),
 *  locale-formatted like every other number in the app rather than a raw
 *  `toFixed`. */
function formatRate(rate: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(rate);
}

function numOrNull(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Native-currency -> base-currency rate for a row, same `fx[cur] ?? 1`
 *  fallback as `rateFor` in lib/finance/portfolio.ts. */
function rateForRow(r: InstrumentRow, base: string, fx: Record<string, number>): number {
  const nativeCur = r.currency ?? "EUR";
  return nativeCur === base ? 1 : (fx[nativeCur] ?? 1);
}

/** The cell value each column is ordered by. A row with no price and one that
 *  has never synced both come back null, so `sortRows` keeps them at the
 *  bottom whichever way the arrow points -- which is where "unknown" belongs
 *  on a page you open to find what is stale. */
function sortValue(
  r: InstrumentRow,
  key: SortKey,
  base: string,
  fx: Record<string, number>,
): string | number | null {
  switch (key) {
    case "name":
      return r.name;
    case "type":
      return r.type;
    case "price":
      return numOrNull(r.last_price);
    case "priceBase": {
      const v = numOrNull(r.last_price);
      return v != null ? v * rateForRow(r, base, fx) : null;
    }
    case "fxRate":
      return rateForRow(r, base, fx);
    case "synced":
      return r.price_synced_at ? Date.parse(r.price_synced_at) : null;
    case "retries":
      // 0 is "never failed", not a small failure count: null keeps it out of
      // the way in both directions, like every other missing value here.
      return r.price_fail_count && r.price_fail_count > 0 ? r.price_fail_count : null;
  }
}
