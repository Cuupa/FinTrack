"use client";

// Manual-valuation editor (COMPETITION.md F8, closes most of G9): an OTHER
// asset (real estate, collectibles, unlisted holdings) has no market price, so
// the user enters dated valuation points here. Those points form the asset's
// price series through the PriceProvider seam
// (lib/finance/manual-valuation.ts) — the most recent point is the current
// value. Points ride the store seam via `setAssetValuations` (replace-set), so
// each edit writes the whole set. Gated by the `manualValuation` flag at the
// call site (asset-detail.tsx).

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import type { Asset } from "@/lib/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "date" | "value";

export function ValuationSection({ asset }: { asset: Asset }) {
  const { data, setAssetValuations } = usePortfolio();
  const { t } = useI18n();
  const cur = asset.currency || data.profile.currency;

  const points = useMemo(
    () => data.valuationPoints.filter((p) => p.assetId === asset.id),
    [data.valuationPoints, asset.id],
  );

  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });

  // Latest entered value = the asset's current value (mirrors manualCurrentPrice).
  const latest = useMemo(() => {
    let best: { date: string; value: number } | null = null;
    for (const p of points) if (!best || p.date > best.date) best = p;
    return best;
  }, [points]);

  const sortedRows = useMemo(() => {
    const rows = [...points];
    rows.sort((a, b) => {
      const cmp = sort.key === "date" ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : a.value - b.value;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [points, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  // Replace-set write: `next` is the whole set of {date, value} for this asset.
  async function persist(next: { date: string; value: number }[]) {
    setBusy(true);
    setError(null);
    try {
      await setAssetValuations(asset.id, next);
      return true;
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("valuation.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const v = parseDecimal(value);
    if (!date || !Number.isFinite(v) || v <= 0) return;
    // Upsert by date: a new value on an existing date overwrites it (edit).
    const next = points.filter((p) => p.date !== date).map((p) => ({ date: p.date, value: p.value }));
    next.push({ date, value: v });
    if (await persist(next)) setValue("");
  }

  async function remove(pointDate: string) {
    const next = points.filter((p) => p.date !== pointDate).map((p) => ({ date: p.date, value: p.value }));
    await persist(next);
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("valuation.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("valuation.intro")}</p>

      {latest && (
        <p className="mt-3 text-sm font-medium" data-private>
          {t("valuation.current", {
            value: formatCurrency(latest.value, cur),
            date: formatDate(latest.date),
          })}
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label className="text-sm font-medium" htmlFor="valuation-date">
            {t("valuation.dateLabel")}
          </label>
          <input
            id="valuation-date"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="valuation-value">
            {t("valuation.valueLabel", { currency: cur })}
          </label>
          <input
            id="valuation-value"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(stripLeadingZero(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="0"
            className={inputCls}
            data-private
          />
        </div>
        <Button
          variant="primary"
          disabled={busy || !date || !value.trim()}
          onClick={() => void add()}
        >
          {t("valuation.add")}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {points.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{t("valuation.empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className={thCls} onClick={() => toggleSort("date")}>
                  {t("valuation.dateLabel")}
                  {arrow("date")}
                </th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort("value")}>
                  {t("valuation.valueLabel", { currency: cur })}
                  {arrow("value")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((p) => (
                <tr
                  key={p.date}
                  className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-3 py-2">{formatDate(p.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-private>
                    {formatCurrency(p.value, cur)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(p.date)}
                      disabled={busy}
                      aria-label={t("valuation.remove")}
                      className="text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
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
    </Card>
  );
}
