"use client";

// Portfolio rebalancing: current vs. target allocation side by side, with an
// editable target grid (existing holdings + freely-added new positions) and the
// buy/sell amounts needed to reach the target. The plan (weights + custom rows
// + mode) is persisted on the profile through the store seam (COMPETITION.md
// F10) so it survives reload — seeded from `data.profile.rebalanceTargets` at
// mount (the page only mounts this view once data has loaded) and written back
// debounced. See RebalancingPage for the load gate.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { summarizeAll } from "@/lib/finance/portfolio";
import { formatCurrency, formatInputDecimal, formatNumber, normalizeZero, parseDecimal, plColor, stripLeadingZero } from "@/lib/format";
import { Button, Card, SectionTitle, SegmentedControl } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Private } from "@/components/ui/private";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PALETTE } from "@/lib/colors";
import { RebalancingTour, TourReplayButton } from "@/components/onboarding/page-tours";

type RebalanceMode = "trade" | "buyOnly";

type SortKey = "position" | "current" | "targetPct" | "targetValue" | "action";

interface Target {
  id: string;
  name: string;
  /** Current value in base currency (0 for a newly-added position). */
  current: number;
  /** Target weight as a percentage (0..100). */
  pct: number;
}

interface EnrichedTarget extends Target {
  targetValue: number;
  delta: number;
  /** Buy-only keeps over-weight/zero-target positions untouched. */
  kept: boolean;
  isCustom: boolean;
}

let customSeq = 0;

export function RebalancingView() {
  const { data, updateProfile } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;

  // The persisted plan. Captured once at mount — the page gates this view
  // behind `!loading`, so the profile (and its plan) is already hydrated.
  const [initialPlan] = useState(() => data.profile.rebalanceTargets);

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
  // We store edits keyed by row id so they survive re-renders — and, seeded
  // from the persisted plan, across reloads.
  const [pctEdits, setPctEdits] = useState<Record<string, number>>(() => ({
    ...initialPlan.weights,
  }));
  const [pctInputs, setPctInputs] = useState<Record<string, string>>({});
  const [customRows, setCustomRows] = useState<{ id: string; name: string }[]>(() =>
    initialPlan.custom.map((c) => ({ ...c })),
  );
  const [mode, setMode] = useState<RebalanceMode>(() => initialPlan.mode);
  // The position highlighted across both donuts + the table row on hover.
  const [activeName, setActiveName] = useState<string | null>(null);
  const [tourReplay, setTourReplay] = useState(0);
  const [confirmNormalise, setConfirmNormalise] = useState(false);

  // Persist the plan (debounced) whenever it changes from what's stored. Writing
  // goes through updateProfile like any other profile field; the local state is
  // the source of truth for the session, so an updateProfile-driven re-render
  // never clobbers an in-flight edit.
  const plan = useMemo(
    () => ({ mode, weights: pctEdits, custom: customRows }),
    [mode, pctEdits, customRows],
  );
  const serialized = useMemo(() => JSON.stringify(plan), [plan]);
  const planRef = useRef(plan);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineRef = useRef(JSON.stringify(initialPlan));

  useEffect(() => {
    planRef.current = plan; // keep the latest for the timer + unmount flush
    if (serialized === baselineRef.current) return; // unchanged from the stored plan
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void updateProfile({ rebalanceTargets: planRef.current }).then(() => {
        dirtyRef.current = false;
        baselineRef.current = serialized;
      });
    }, 700);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  // Flush a pending edit if the user navigates away before the debounce fires.
  useEffect(
    () => () => {
      if (dirtyRef.current) void updateProfile({ rebalanceTargets: planRef.current });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("position");
  const enrichedRows = useMemo<EnrichedTarget[]>(
    () =>
      rows.map((r) => {
        const rawTarget = (r.pct / 100) * total;
        // Buy-only keeps over-weight/zero-target positions untouched.
        const kept = buyOnly && rawTarget < r.current;
        const targetValue = kept ? r.current : rawTarget;
        return {
          ...r,
          targetValue,
          delta: targetValue - r.current,
          kept,
          isCustom: r.id.startsWith("custom-"),
        };
      }),
    [rows, total, buyOnly],
  );
  const sortedRows = useMemo(
    () =>
      applySort(enrichedRows, (r, key) => {
        if (key === "position") return r.name;
        if (key === "current") return r.current;
        if (key === "targetPct") return r.pct;
        if (key === "targetValue") return r.targetValue;
        return r.delta;
      }),
    [enrichedRows, applySort],
  );

  // One colour per position (by name), shared across both donuts and the table
  // swatches so the same holding is the same colour everywhere.
  const colorByName = useMemo(() => {
    const map: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (!(r.name in map)) map[r.name] = PALETTE[i % PALETTE.length];
    });
    return map;
  }, [rows]);

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">{t("rebalance.addHoldings")}</p>
      </Card>
    );
  }

  const setPct = (id: string, raw: string) => {
    setPctInputs((e) => ({ ...e, [id]: raw }));
    const v = parseDecimal(raw);
    setPctEdits((e) => ({ ...e, [id]: Number.isFinite(v) ? Math.max(0, v) : 0 }));
  };

  const addCustom = () => {
    // Time-based suffix so ids stay unique across reloads (customSeq resets to
    // 0 on mount, but persisted rows may already hold "custom-…" ids).
    const id = `custom-${Date.now().toString(36)}-${++customSeq}`;
    setCustomRows((c) => [...c, { id, name: t("rebalance.newPositionName", { n: c.length + 1 }) }]);
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
    setPctInputs((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const normalize = () => {
    if (targetSum <= 0) return;
    const factor = 100 / targetSum;
    const normalized = Object.fromEntries(
      rows.map((r) => [r.id, Math.round(r.pct * factor * 10) / 10]),
    );
    setPctEdits(normalized);
    setPctInputs(Object.fromEntries(
      Object.entries(normalized).map(([id, value]) => [id, formatInputDecimal(value, 1)]),
    ));
  };

  return (
    <div className="space-y-6">
      <RebalancingTour restartToken={tourReplay} />
      <Card>
        <SectionTitle
          actions={
            <span className="text-sm tabular-nums text-zinc-500" data-private>
              {formatCurrency(currentTotal, base)}
            </span>
          }
        >
          {t("rebalance.deviation")}
        </SectionTitle>
        <div className="mt-4">
          <DeviationBars
            rows={enrichedRows}
            currentTotal={currentTotal}
            colorByName={colorByName}
            activeName={activeName}
            onHover={setActiveName}
          />
        </div>
      </Card>

      <Card>
        <SectionTitle
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl<RebalanceMode>
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { label: t("rebalance.modeTrade"), value: "trade" },
                  { label: t("rebalance.modeBuyOnly"), value: "buyOnly" },
                ]}
              />
              <span
                className={`inline-flex items-center gap-1 text-sm tabular-nums ${
                  Math.abs(targetSum - 100) < 0.05 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {t("rebalance.total")}: {normalizeZero(targetSum, 1).toFixed(1)}%
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmNormalise(true)}
                disabled={targetSum <= 0 || Math.abs(targetSum - 100) < 0.05}
              >
                {t("rebalance.normalise")}
              </Button>
            </div>
          }
        >
          {t("rebalance.targetAllocation")}
          <TourReplayButton onClick={() => setTourReplay((n) => n + 1)} />
        </SectionTitle>

        {targetSum > 0 && Math.abs(targetSum - 100) >= 0.05 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <span className="font-medium tabular-nums">
              {t("rebalance.total")}: {normalizeZero(targetSum, 1).toFixed(1)}%
            </span>
            <span>{t("rebalance.total.hint")}</span>
          </div>
        )}

        <div data-tour="rebalance-table">
          <Table className="mt-4" ariaLabel={t("rebalance.targetAllocation")}>
            <Thead>
              <Th sort={sort} sortKey="position" onSort={toggleSort}>
                {t("rebalance.colPosition")}
              </Th>
              <Th align="right" sort={sort} sortKey="current" onSort={toggleSort}>
                {t("rebalance.current")}
              </Th>
              <Th
                data-tour="rebalance-target-pct"
                align="right"
                sort={sort}
                sortKey="targetPct"
                onSort={toggleSort}
              >
                {t("rebalance.colTargetPct")}
              </Th>
              <Th align="right" sort={sort} sortKey="targetValue" onSort={toggleSort}>
                {t("rebalance.colTargetValue")}
              </Th>
              <Th
                data-tour="rebalance-orders"
                align="right"
                sort={sort}
                sortKey="action"
                onSort={toggleSort}
              >
                {t("rebalance.colAction")}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {sortedRows.map((r) => (
                <Tr
                  key={r.id}
                  selected={activeName === r.name}
                  onMouseEnter={() => setActiveName(r.name)}
                  onMouseLeave={() => setActiveName(null)}
                >
                  <Td>
                    <div className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ backgroundColor: colorByName[r.name] ?? "#a1a1aa" }}
                      />
                      {r.isCustom ? (
                        <input
                          value={r.name}
                          onChange={(e) => renameCustom(r.id, e.target.value)}
                          className="w-40 rounded-sm border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                        />
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
                    </div>
                  </Td>
                  <Td align="right" className="tabular-nums text-zinc-500" data-private>
                    {formatCurrency(r.current, base)}
                  </Td>
                  <Td align="right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={pctInputs[r.id] ?? formatInputDecimal(r.pct)}
                      onChange={(e) => setPct(r.id, stripLeadingZero(e.target.value))}
                      className="w-20 rounded-sm border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </Td>
                  <Td align="right" className="tabular-nums" data-private>
                    {formatCurrency(r.targetValue, base)}
                  </Td>
                  <Td
                    align="right"
                    className={`tabular-nums ${
                      r.kept || Math.abs(r.delta) < 0.005
                        ? "text-zinc-400"
                        : "text-zinc-700 dark:text-zinc-200"
                    }`}
                    data-private
                  >
                    {r.kept || Math.abs(r.delta) < 0.005 ? (
                      t("rebalance.keep")
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden className="text-zinc-400">
                          {r.delta >= 0 ? "↑" : "↓"}
                        </span>
                        {r.delta >= 0 ? t("rebalance.buy") : t("rebalance.sell")}{" "}
                        {formatCurrency(Math.abs(r.delta), base)}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {r.isCustom && (
                      <button
                        type="button"
                        onClick={() => removeCustom(r.id)}
                        className="text-xs text-zinc-400 hover:text-red-500"
                        aria-label={t("rebalance.removePosition")}
                      >
                        ✕
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <Button variant="secondary" size="sm" onClick={addCustom}>
            {t("rebalance.addPosition")}
          </Button>
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

      <ConfirmDialog
        open={confirmNormalise}
        title={t("rebalance.normalise")}
        message={t("rebalance.normalise.confirm", {
          sum: normalizeZero(targetSum, 1).toFixed(1),
          factor: targetSum > 0 ? (100 / targetSum).toFixed(3) : "1",
        })}
        confirmLabel={t("rebalance.normalise")}
        onConfirm={() => {
          normalize();
          setConfirmNormalise(false);
        }}
        onCancel={() => setConfirmNormalise(false)}
      />
    </div>
  );
}

/**
 * Ist-vs-Ziel deviation view (replaces the two near-identical donuts, spec
 * 11.4): one horizontal row per position with the current weight (solid) and
 * target weight (outlined) bars scaled to the largest weight, plus the drift in
 * percentage points. Hover is shared with the table row through `activeName`.
 */
function DeviationBars({
  rows,
  currentTotal,
  colorByName,
  activeName,
  onHover,
}: {
  rows: EnrichedTarget[];
  currentTotal: number;
  colorByName: Record<string, string>;
  activeName: string | null;
  onHover: (name: string | null) => void;
}) {
  const { t } = useI18n();
  const bars = useMemo(() => {
    const mapped = rows.map((r) => {
      const currentPct = currentTotal > 0 ? (r.current / currentTotal) * 100 : 0;
      const targetPct = r.pct;
      return { id: r.id, name: r.name, currentPct, targetPct, diff: targetPct - currentPct };
    });
    return mapped
      .filter((b) => b.currentPct > 0.01 || b.targetPct > 0.01)
      .sort((a, b) => Math.max(b.currentPct, b.targetPct) - Math.max(a.currentPct, a.targetPct));
  }, [rows, currentTotal]);

  const maxPct = Math.max(1, ...bars.map((b) => Math.max(b.currentPct, b.targetPct)));
  // Both bars share one baseline and one scale: a rounded axis max so the ticks
  // land on clean percentages and a full-length bar reads as a real weight, not
  // just "the largest one".
  const { axisMax, ticks } = niceAxis(maxPct);

  if (bars.length === 0) {
    return <p className="text-sm text-zinc-500">{t("rebalance.setWeights")}</p>;
  }

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center gap-4 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-zinc-500" />
          {t("rebalance.current")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full border border-zinc-400" />
          {t("rebalance.target")}
        </span>
      </div>
      {bars.map((b) => {
        const color = colorByName[b.name] ?? "#a1a1aa";
        const active = activeName === b.name;
        const dim = activeName !== null && !active;
        return (
          <div
            key={b.id}
            onMouseEnter={() => onHover(b.name)}
            onMouseLeave={() => onHover(null)}
            className={`flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${
              active ? "bg-zinc-100 dark:bg-zinc-800/50" : ""
            }`}
            style={{ opacity: dim ? 0.4 : 1 }}
          >
            <div className={`flex ${NAME_COL} shrink-0 items-center gap-2`}>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: color }}
              />
              <span className="truncate text-sm" title={b.name}>
                {b.name}
              </span>
            </div>
            <div className="relative h-4 flex-1">
              {ticks.map((tk) => (
                <div
                  key={tk}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-zinc-200/80 dark:bg-zinc-700/60"
                  style={{ left: `${(tk / axisMax) * 100}%` }}
                />
              ))}
              <div
                className="absolute left-0 top-0 h-1.5 rounded-full"
                style={{ width: `${(b.currentPct / axisMax) * 100}%`, backgroundColor: color }}
              />
              <div
                className="absolute bottom-0 left-0 h-1.5 rounded-full border"
                style={{
                  width: `${(b.targetPct / axisMax) * 100}%`,
                  borderColor: color,
                  backgroundColor: `${color}22`,
                }}
              />
            </div>
            <span
              className={`w-16 shrink-0 text-right text-sm tabular-nums ${
                Math.abs(b.diff) < 0.05 ? "text-zinc-400" : plColor(b.diff)
              }`}
            >
              {(() => {
                // Normalize a rounds-to-zero diff so a tiny negative never
                // renders as "-0,0 %"; a real zero shows unsigned.
                const d = normalizeZero(b.diff, 1);
                return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
              })()}
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-1">
        <div className={`${NAME_COL} shrink-0`} />
        <div className="relative h-4 flex-1">
          {ticks.map((tk, i) => (
            <span
              key={tk}
              className={`absolute top-0 text-[10px] tabular-nums text-zinc-400 ${
                i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
              }`}
              style={{ left: `${(tk / axisMax) * 100}%` }}
            >
              {formatNumber(tk, tk % 1 === 0 ? 0 : 1)}%
            </span>
          ))}
        </div>
        <div className="w-16 shrink-0" />
      </div>
    </div>
  );
}

// Shared width for the position-name column across the bars and the axis row,
// widening on roomier viewports so names truncate only when they genuinely
// have to.
const NAME_COL = "w-44 lg:w-56 xl:w-64";

// A rounded axis maximum >= the largest weight, with evenly spaced ticks that
// land on clean percentages (0, step, 2·step, … up to the max).
function niceAxis(maxPct: number): { axisMax: number; ticks: number[] } {
  if (!(maxPct > 0)) return { axisMax: 1, ticks: [0, 1] };
  const rawStep = maxPct / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const n = rawStep / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  const axisMax = Math.max(step, Math.ceil(maxPct / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= axisMax + step * 1e-6; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return { axisMax, ticks };
}
