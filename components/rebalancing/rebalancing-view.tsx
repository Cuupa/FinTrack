"use client";

// Portfolio rebalancing: current vs. target allocation side by side, with an
// editable target grid (existing holdings + freely-added new positions) and the
// buy/sell amounts needed to reach the target. Client-only — nothing persisted.

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import type { Slice } from "@/lib/finance/allocation";
import { formatCurrency, parseDecimal, plColor } from "@/lib/format";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { Private } from "@/components/ui/private";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PALETTE } from "@/lib/colors";
import { RebalancingTour, TourReplayButton } from "@/components/onboarding/page-tours";

type RebalanceMode = "trade" | "buyOnly";

interface Target {
  id: string;
  name: string;
  /** Current value in base currency (0 for a newly-added position). */
  current: number;
  /** Target weight as a percentage (0..100). */
  pct: number;
}

let customSeq = 0;

export function RebalancingView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  const currentTotal = useMemo(
    () => holdings.reduce((s, h) => s + h.marketValue, 0),
    [holdings],
  );

  // Target rows: holdings (default target = current weight) + custom additions.
  // We store edits keyed by row id so they survive re-renders.
  const [pctEdits, setPctEdits] = useState<Record<string, number>>({});
  const [customRows, setCustomRows] = useState<{ id: string; name: string }[]>([]);
  const [mode, setMode] = useState<RebalanceMode>("trade");
  // The position highlighted across both donuts + the table row on hover.
  const [activeName, setActiveName] = useState<string | null>(null);
  const [tourReplay, setTourReplay] = useState(0);

  const rows = useMemo<Target[]>(() => {
    const base: Target[] = holdings.map((h) => {
      const id = h.asset.id;
      const defaultPct = currentTotal > 0 ? (h.marketValue / currentTotal) * 100 : 0;
      return {
        id,
        name: h.asset.name,
        current: h.marketValue,
        pct: pctEdits[id] ?? Math.round(defaultPct * 10) / 10,
      };
    });
    const custom: Target[] = customRows.map((c) => ({
      id: c.id,
      name: c.name,
      current: 0,
      pct: pctEdits[c.id] ?? 0,
    }));
    return [...base, ...custom];
  }, [holdings, currentTotal, pctEdits, customRows]);

  const targetSum = rows.reduce((s, r) => s + r.pct, 0);
  const buyOnly = mode === "buyOnly";
  // Buy-only: no selling allowed, so the new total is the smallest T at which
  // every target-weighted value is >= what's already held — i.e. set by the most
  // over-weight target (current / weight). Underweight positions are then topped
  // up with fresh money; over-weight ones are simply left as-is.
  const buyOnlyTotal = useMemo(() => {
    const cands = rows.filter((r) => r.pct > 0);
    if (cands.length === 0) return currentTotal;
    return Math.max(currentTotal, ...cands.map((r) => r.current / (r.pct / 100)));
  }, [rows, currentTotal]);
  // The pool to allocate. Trade mode rebalances the existing capital in place;
  // buy-only grows the pool to `buyOnlyTotal` with new contributions.
  const total = buyOnly ? buyOnlyTotal : currentTotal;
  const additionalNeeded = Math.max(0, total - currentTotal);

  // One colour per position (by name), shared across both donuts and the table
  // swatches so the same holding is the same colour everywhere.
  const colorByName = useMemo(() => {
    const map: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (!(r.name in map)) map[r.name] = PALETTE[i % PALETTE.length];
    });
    return map;
  }, [rows]);

  const currentSlices: Slice[] = useMemo(
    () => rows.filter((r) => r.current > 0).map((r) => ({ label: r.name, value: r.current })),
    [rows],
  );
  const targetSlices: Slice[] = useMemo(
    () =>
      rows
        .map((r) => ({ label: r.name, value: (r.pct / 100) * total }))
        .filter((s) => s.value > 0),
    [rows, total],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("rebalance.addHoldings")}</p>
      </Card>
    );
  }

  const setPct = (id: string, raw: string) => {
    const v = parseDecimal(raw);
    setPctEdits((e) => ({ ...e, [id]: Number.isFinite(v) ? Math.max(0, v) : 0 }));
  };

  const addCustom = () => {
    const id = `custom-${++customSeq}`;
    setCustomRows((c) => [...c, { id, name: `New position ${c.length + 1}` }]);
  };

  const renameCustom = (id: string, name: string) =>
    setCustomRows((c) => c.map((r) => (r.id === id ? { ...r, name } : r)));

  const removeCustom = (id: string) => {
    setCustomRows((c) => c.filter((r) => r.id !== id));
    setPctEdits((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const normalize = () => {
    if (targetSum <= 0) return;
    const factor = 100 / targetSum;
    setPctEdits(() => Object.fromEntries(rows.map((r) => [r.id, Math.round(r.pct * factor * 10) / 10])));
  };

  return (
    <div className="space-y-6">
      <RebalancingTour restartToken={tourReplay} />
      <Card>
        <div className="flex flex-wrap items-center justify-around gap-8">
          <RebalanceDonut
            title={t("rebalance.current")}
            slices={currentSlices}
            total={currentTotal}
            currency={base}
            colorByName={colorByName}
            activeName={activeName}
            onHover={setActiveName}
          />

          {targetSlices.length > 0 ? (
            <RebalanceDonut
              title={t("rebalance.target")}
              slices={targetSlices}
              total={total}
              currency={base}
              colorByName={colorByName}
              activeName={activeName}
              onHover={setActiveName}
            />
          ) : (
            <div className="flex h-56 items-center justify-center text-center text-sm text-zinc-500">
              {t("rebalance.setWeights")}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              {t("rebalance.targetAllocation")}
              <TourReplayButton onClick={() => setTourReplay((n) => n + 1)} />
            </h3>
            <SegmentedControl<RebalanceMode>
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { label: t("rebalance.modeTrade"), value: "trade" },
                { label: t("rebalance.modeBuyOnly"), value: "buyOnly" },
              ]}
            />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`tabular-nums ${
                Math.abs(targetSum - 100) < 0.05 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {t("rebalance.total")}: {targetSum.toFixed(1)}%
            </span>
            <button
              type="button"
              onClick={normalize}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t("rebalance.normalise")}
            </button>
          </div>
        </div>

        <div data-tour="rebalance-table" className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">{t("rebalance.colPosition")}</th>
                <th className="py-2 pr-3 text-right">{t("rebalance.current")}</th>
                <th data-tour="rebalance-target-pct" className="py-2 pr-3 text-right">
                  {t("rebalance.colTargetPct")}
                </th>
                <th className="py-2 pr-3 text-right">{t("rebalance.colTargetValue")}</th>
                <th data-tour="rebalance-orders" className="py-2 pr-3 text-right">
                  {t("rebalance.colAction")}
                </th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rawTarget = (r.pct / 100) * total;
                // Buy-only keeps over-weight/zero-target positions untouched.
                const kept = buyOnly && rawTarget < r.current;
                const targetValue = kept ? r.current : rawTarget;
                const delta = targetValue - r.current;
                const isCustom = r.id.startsWith("custom-");
                return (
                  <tr
                    key={r.id}
                    onMouseEnter={() => setActiveName(r.name)}
                    onMouseLeave={() => setActiveName(null)}
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
                      activeName === r.name ? "bg-zinc-50 dark:bg-zinc-800/40" : ""
                    }`}
                  >
                    <td className="py-2 pr-3">
                      <div className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: colorByName[r.name] ?? "#a1a1aa" }}
                        />
                        {isCustom ? (
                          <input
                            value={r.name}
                            onChange={(e) => renameCustom(r.id, e.target.value)}
                            className="w-40 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                          />
                        ) : (
                          <span className="font-medium">{r.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-500" data-private>
                      {formatCurrency(r.current, base)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min={0}
                        value={r.pct}
                        onChange={(e) => setPct(r.id, e.target.value)}
                        className="w-20 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums" data-private>
                      {formatCurrency(targetValue, base)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        kept || Math.abs(delta) < 0.005 ? "text-zinc-400" : plColor(delta)
                      }`}
                      data-private
                    >
                      {kept || Math.abs(delta) < 0.005
                        ? t("rebalance.keep")
                        : `${delta >= 0 ? t("rebalance.buy") : t("rebalance.sell")} ${formatCurrency(Math.abs(delta), base)}`}
                    </td>
                    <td className="py-2 text-right">
                      {isCustom && (
                        <button
                          type="button"
                          onClick={() => removeCustom(r.id)}
                          className="text-xs text-zinc-400 hover:text-red-500"
                          aria-label={t("rebalance.removePosition")}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={addCustom}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {t("rebalance.addPosition")}
          </button>
          <div className="flex flex-wrap items-center gap-4 text-zinc-500">
            {buyOnly && (
              <span>
                {t("rebalance.additional")}{" "}
                <Private>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(additionalNeeded, base)}
                  </span>
                </Private>
              </span>
            )}
            <span>
              {t("rebalance.pool")} <Private>{formatCurrency(total, base)}</Private>
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** A donut-only allocation chart with a centred total (no legend of its own). */
function RebalanceDonut({
  title,
  slices,
  total,
  currency,
  colorByName,
  activeName,
  onHover,
}: {
  title: string;
  slices: Slice[];
  total: number;
  currency: string;
  colorByName: Record<string, string>;
  activeName: string | null;
  onHover: (name: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center">
      <h2 className="mb-3 text-sm font-semibold text-zinc-500">{title}</h2>
      <div className="relative h-56 w-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={74}
              outerRadius={104}
              paddingAngle={slices.length > 1 ? 2 : 0}
              cornerRadius={5}
              stroke="none"
              isAnimationActive={false}
              onMouseEnter={(_, i: number) => onHover(slices[i]?.label ?? null)}
              onMouseLeave={() => onHover(null)}
            >
              {slices.map((s) => (
                <Cell
                  key={s.label}
                  fill={colorByName[s.label] ?? "#a1a1aa"}
                  opacity={activeName === null || activeName === s.label ? 1 : 0.25}
                  style={{ transition: "opacity 150ms" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400">{t("common.total")}</span>
          <span className="mt-0.5 text-lg font-semibold tabular-nums" data-private>
            {formatCurrency(total, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
