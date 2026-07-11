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
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency, formatInstant } from "@/lib/format";
import { intlLocale } from "@/lib/i18n/locale";
import { priceStaleness, needsAttention, type PriceStaleness } from "@/lib/admin/price-health";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
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
}

type SortKey = "name" | "type" | "price" | "priceBase" | "fxRate" | "synced";

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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "synced", dir: 1 });
  const [revalidating, setRevalidating] = useState<Set<string>>(new Set());
  const [revalidatingAll, setRevalidatingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("instruments")
      .select(
        "id, isin, wkn, symbol, name, type, currency, quote_source, quote_id, last_price, price_synced_at",
      )
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
    const dir = sort.dir;
    return [...list].sort((a, b) => compare(a, b, sort.key, base, fx) * dir);
  }, [rows, query, staleOnly, sort, base, fx]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

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
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.prices.filterPlaceholder")}
            className="w-full max-w-xs rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <Th label={t("admin.prices.colName")} k="name" sort={sort} onSort={toggleSort} />
                  <Th label={t("admin.prices.colType")} k="type" sort={sort} onSort={toggleSort} />
                  <th className="px-3 py-2 font-medium">{t("admin.prices.colQuote")}</th>
                  <Th
                    label={t("admin.prices.colPrice")}
                    k="price"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <Th
                    label={t("admin.prices.colPriceBase")}
                    k="priceBase"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <Th
                    label={t("admin.prices.colFxRate")}
                    k="fxRate"
                    sort={sort}
                    onSort={toggleSort}
                    align="right"
                  />
                  <Th
                    label={t("admin.prices.colSynced")}
                    k="synced"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const lastPrice = numOrNull(r.last_price);
                  const status = priceStaleness(r.price_synced_at);
                  const isRevalidating = revalidating.has(r.id);
                  const nativeCur = r.currency ?? "EUR";
                  const rate = rateForRow(r, base, fx);
                  const basePrice = lastPrice != null ? lastPrice * rate : null;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-zinc-500">{identifier(r)}</div>
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{t(`assetType.${r.type}`)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                        {r.quote_source ?? "—"}
                        {r.quote_id ? `:${r.quote_id}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {lastPrice != null ? (
                          formatCurrency(lastPrice, nativeCur)
                        ) : (
                          <EstimatedBadge compact tip={t("admin.prices.syntheticTip")} />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {basePrice != null ? formatCurrency(basePrice, base) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                        {lastPrice != null ? formatRate(rate) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <StalenessBadge status={status} label={t(`admin.prices.staleness.${status}`)} />
                          {r.price_synced_at && (
                            <span className="text-xs text-zinc-500">
                              {formatInstant(r.price_synced_at)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

function compare(
  a: InstrumentRow,
  b: InstrumentRow,
  key: SortKey,
  base: string,
  fx: Record<string, number>,
): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "type":
      return a.type.localeCompare(b.type);
    case "price":
      return (numOrNull(a.last_price) ?? -1) - (numOrNull(b.last_price) ?? -1);
    case "priceBase": {
      const av = numOrNull(a.last_price);
      const bv = numOrNull(b.last_price);
      const abase = av != null ? av * rateForRow(a, base, fx) : -1;
      const bbase = bv != null ? bv * rateForRow(b, base, fx) : -1;
      return abase - bbase;
    }
    case "fxRate":
      return rateForRow(a, base, fx) - rateForRow(b, base, fx);
    case "synced": {
      const at = a.price_synced_at ? Date.parse(a.price_synced_at) : 0;
      const bt = b.price_synced_at ? Date.parse(b.price_synced_at) : 0;
      return at - bt;
    }
  }
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
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : ""}`}>
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
