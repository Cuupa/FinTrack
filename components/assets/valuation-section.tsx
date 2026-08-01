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
import { DeleteAction, RowActions } from "@/components/ui/row-actions";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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
  const sort = useSort<"date" | "value">("date", "desc");

  // Latest entered value = the asset's current value (mirrors manualCurrentPrice).
  const latest = useMemo(() => {
    let best: { date: string; value: number } | null = null;
    for (const p of points) if (!best || p.date > best.date) best = p;
    return best;
  }, [points]);

  const sortedRows = useMemo(
    () => sort.apply(points, (p, key) => (key === "date" ? p.date : p.value)),
    [points, sort],
  );

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

  const pager = usePagination(sortedRows);

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
        <div className="mt-4">
          <Table>
            <Thead>
              <Th sort={sort.sort} sortKey="date" onSort={sort.toggle}>
                {t("valuation.dateLabel")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="value" onSort={sort.toggle}>
                {t("valuation.valueLabel", { currency: cur })}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {pager.rows.map((p) => (
                <Tr key={p.date}>
                  <Td>{formatDate(p.date)}</Td>
                  <Td align="right" className="tabular-nums" data-private>
                    {formatCurrency(p.value, cur)}
                  </Td>
                  <Td align="right">
                    <RowActions>
                      <DeleteAction
                        label={t("valuation.remove")}
                        onClick={() => void remove(p.date)}
                        disabled={busy}
                      />
                    </RowActions>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <TablePagination pager={pager} />
        </div>
      )}
    </Card>
  );
}
