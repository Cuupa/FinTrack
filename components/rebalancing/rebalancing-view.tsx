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
import { formatCurrency, formatNumber, parseDecimal, plColor } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { Private } from "@/components/ui/private";

const PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#06b6d4",
  "#a855f7",
];

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
  // The pool to allocate: keep the existing capital (rebalance in place). New
  // positions are funded by trimming over-weight holdings.
  const total = currentTotal;

  // One colour per position (by name), shared across both donuts and the legend
  // so the same holding is the same colour everywhere.
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
        <p className="text-sm text-zinc-500">Add holdings to plan a rebalance.</p>
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
      <Card>
        {/* Two donuts share one legend, so neither carries its own overlapping
            legend (the previous bug). */}
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto_1fr]">
          <RebalanceDonut
            title="Current"
            slices={currentSlices}
            total={currentTotal}
            currency={base}
            colorByName={colorByName}
          />

          <div className="min-w-0 lg:w-72">
            <ul className="space-y-1.5 text-sm">
              {rows.map((r) => {
                const curPct = currentTotal > 0 ? (r.current / currentTotal) * 100 : 0;
                return (
                  <li key={r.id} className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-[4px]"
                      style={{ backgroundColor: colorByName[r.name] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                      {r.name}
                    </span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-zinc-400">
                      {formatNumber(curPct, 1)}%
                    </span>
                    <span className="shrink-0 text-zinc-400">→</span>
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
                      {formatNumber(r.pct, 1)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {targetSlices.length > 0 ? (
            <RebalanceDonut
              title="Target"
              slices={targetSlices}
              total={total}
              currency={base}
              colorByName={colorByName}
            />
          ) : (
            <div className="flex h-56 items-center justify-center text-center text-sm text-zinc-500">
              Set target weights below.
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Target allocation</h3>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`tabular-nums ${
                Math.abs(targetSum - 100) < 0.05 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              Total: {targetSum.toFixed(1)}%
            </span>
            <button
              type="button"
              onClick={normalize}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Normalise to 100%
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Position</th>
                <th className="py-2 pr-3 text-right">Current</th>
                <th className="py-2 pr-3 text-right">Target %</th>
                <th className="py-2 pr-3 text-right">Target value</th>
                <th className="py-2 pr-3 text-right">Action</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const targetValue = (r.pct / 100) * total;
                const delta = targetValue - r.current;
                const isCustom = r.id.startsWith("custom-");
                return (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                  >
                    <td className="py-2 pr-3">
                      {isCustom ? (
                        <input
                          value={r.name}
                          onChange={(e) => renameCustom(r.id, e.target.value)}
                          className="w-40 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                        />
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
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
                    <td className={`py-2 pr-3 text-right tabular-nums ${plColor(delta)}`} data-private>
                      {delta >= 0 ? "Buy " : "Sell "}
                      {formatCurrency(Math.abs(delta), base)}
                    </td>
                    <td className="py-2 text-right">
                      {isCustom && (
                        <button
                          type="button"
                          onClick={() => removeCustom(r.id)}
                          className="text-xs text-zinc-400 hover:text-red-500"
                          aria-label="Remove position"
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
            + Add target position
          </button>
          <span className="text-zinc-500">
            Pool to allocate: <Private>{formatCurrency(total, base)}</Private>
          </span>
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
}: {
  title: string;
  slices: Slice[];
  total: number;
  currency: string;
  colorByName: Record<string, string>;
}) {
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
            >
              {slices.map((s) => (
                <Cell key={s.label} fill={colorByName[s.label] ?? "#a1a1aa"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400">Total</span>
          <span className="mt-0.5 text-lg font-semibold tabular-nums" data-private>
            {formatCurrency(total, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
