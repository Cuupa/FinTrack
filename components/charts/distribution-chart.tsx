"use client";

// Probability-fan chart for the Monte Carlo simulation (PRD §3.3): shaded
// percentile bands (worst→best, 10–90, 25–75) with the median line and the
// total-contributed reference line.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonteCarloResult } from "@/lib/finance/monte-carlo";
import { formatCurrency, formatPercent } from "@/lib/format";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import type { ChartMode, ChartScale } from "./performance-chart";
import { axisCurrencyFormatter, yAxisWidth } from "./axis";

/**
 * Regular x-axis year ticks: 0, step, 2*step, … up to `maxYear`, using the
 * smallest step from [1, 2, 5, 10, 20] that keeps `maxYear / step <= 8`
 * ticks. `maxYear` itself is always the last tick, appended even if the
 * regular stepping doesn't land exactly on it.
 */
export function yearTicks(maxYear: number): number[] {
  if (maxYear <= 0) return [0];
  const steps = [1, 2, 5, 10, 20];
  const step = steps.find((s) => maxYear / s <= 8) ?? steps[steps.length - 1];
  const ticks: number[] = [];
  for (let y = 0; y <= maxYear; y += step) ticks.push(y);
  if (ticks[ticks.length - 1] !== maxYear) ticks.push(maxYear);
  return ticks;
}

export function DistributionChart({
  result,
  currency,
  scale = "linear",
  mode = "currency",
  height = 360,
  highlight = null,
  phaseBoundaryYear,
  phaseBoundaryLabel,
}: {
  result: MonteCarloResult;
  currency: string;
  scale?: ChartScale;
  mode?: ChartMode;
  height?: number;
  /** Series key to emphasise (others dim) — driven by legend hover. */
  highlight?: string | null;
  /** X (year) where the accumulation phase ends and withdrawal begins. */
  phaseBoundaryYear?: number;
  /** Localized label shown next to the phase boundary line. */
  phaseBoundaryLabel?: string;
}) {
  const { t } = useI18n();
  // Per-series opacity helpers for the legend-hover highlight.
  const areaOpacity = (key: string, base: number) =>
    highlight == null ? base : highlight === key ? Math.min(0.6, base * 2.2) : base * 0.3;
  const lineOpacity = (key: string) => (highlight == null || highlight === key ? 1 : 0.2);
  // Percent mode expresses each band as growth over what was contributed by
  // that year, so the contributed line is a flat 0% baseline.
  const pct = (v: number, c: number) => (c > 0 ? v / c - 1 : 0);
  // Log scale is only meaningful for positive absolute values (currency mode).
  const useLog = scale === "log" && mode === "currency";
  const rawData = result.bands.map((b) =>
    mode === "percent"
      ? {
          year: b.year,
          rangeFull: [pct(b.worst, b.contributed), pct(b.best, b.contributed)] as [number, number],
          range80: [pct(b.p10, b.contributed), pct(b.p90, b.contributed)] as [number, number],
          range50: [pct(b.p25, b.contributed), pct(b.p75, b.contributed)] as [number, number],
          median: pct(b.median, b.contributed),
          contributed: 0,
        }
      : {
          year: b.year,
          rangeFull: [b.worst, b.best] as [number, number],
          range80: [b.p10, b.p90] as [number, number],
          range50: [b.p25, b.p75] as [number, number],
          median: b.median,
          contributed: b.contributed,
        },
  );

  const fmtVal = (n: number) =>
    mode === "percent" ? formatPercent(n) : formatCurrency(n, currency);

  const allValues = rawData.flatMap((d) => [
    d.median,
    d.contributed,
    ...d.rangeFull,
    ...d.range80,
    ...d.range50,
  ]);
  const positives = allValues.filter((v) => v > 0);
  const logLo = positives.length ? Math.min(...positives) : 1;
  const logHi = positives.length ? Math.max(...positives) : 1;
  // Depleted runs are real 0s in the sample. On a log axis, log(0) is
  // undefined and Recharts silently breaks the Area/Line segment there — a
  // purely visual gap, not a data problem. Floor the *plotted* geometry to a
  // value far below the smallest real positive so the series still reaches
  // the horizon; the tooltip reads the unfloored raw fields below so it still
  // shows the true 0.
  const logFloor = positives.length ? Math.max(1, logLo / 1000) : 1;
  const floor = (v: number) => Math.max(v, logFloor);
  const floorRange = (r: [number, number]): [number, number] => [floor(r[0]), floor(r[1])];
  const data = rawData.map((d) => ({
    ...d,
    rangeFull: useLog ? floorRange(d.rangeFull) : d.rangeFull,
    range80: useLog ? floorRange(d.range80) : d.range80,
    range50: useLog ? floorRange(d.range50) : d.range50,
    median: useLog ? floor(d.median) : d.median,
    // Unfloored values for the tooltip — it must keep showing true 0s.
    rangeFullRaw: d.rangeFull,
    range80Raw: d.range80,
    range50Raw: d.range50,
    medianRaw: d.median,
  }));
  const maxYear = data.length ? data[data.length - 1].year : 0;

  // Approximate axis extremes — feeds both the currency formatter's
  // compact/precise decision and the snug axis width below. Not the exact
  // tick set Recharts will draw (it auto-generates those), but min/max of the
  // plotted values is a good proxy for the widest label.
  const axisNums = useLog
    ? [logLo, logHi]
    : allValues.length
      ? [Math.min(...allValues), Math.max(...allValues)]
      : [0, 0];
  // Same compact-for-large/precise-for-small currency formatting as the main
  // performance chart, so large (e.g. 7-figure) projections don't force a
  // wide axis; reused rather than duplicated.
  const formatCurrencyTick = axisCurrencyFormatter(axisNums, currency);
  const formatYTick = (v: number) => (mode === "percent" ? formatPercent(v, 0) : formatCurrencyTick(v));
  const yWidth = yAxisWidth(axisNums.map(formatYTick));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
        {phaseBoundaryYear != null && (
          <ReferenceArea
            x1={phaseBoundaryYear}
            x2={maxYear}
            fill="currentColor"
            className="text-zinc-500"
            fillOpacity={0.05}
            stroke="none"
          />
        )}
        <XAxis
          dataKey="year"
          type="number"
          // Pin the axis to the real [0, last-year] range with no side padding so
          // year 0 sits flush at the left edge (a category axis leaves a gap that
          // looked like empty space before the curve, most visibly on log scale).
          domain={[0, maxYear]}
          allowDecimals={false}
          padding={{ left: 0, right: 0 }}
          ticks={yearTicks(maxYear)}
          interval={0}
          tickFormatter={(y) => `${y}y`}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-zinc-400"
        />
        <YAxis
          scale={useLog ? "log" : "linear"}
          domain={useLog ? [logFloor, logHi] : ["auto", "auto"]}
          allowDataOverflow={useLog}
          tickFormatter={formatYTick}
          width={yWidth}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-zinc-400"
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "rgba(120,120,120,0.4)" }}
          content={({ active, payload }) => (
            <ChartTooltip active={active} payload={payload} fmtVal={fmtVal} t={t} />
          )}
        />
        <Area
          dataKey="rangeFull"
          stroke="none"
          fill="#6366f1"
          fillOpacity={areaOpacity("rangeFull", 0.08)}
          activeDot={false}
          isAnimationActive={false}
        />
        <Area
          dataKey="range80"
          stroke="none"
          fill="#6366f1"
          fillOpacity={areaOpacity("range80", 0.16)}
          activeDot={false}
          isAnimationActive={false}
        />
        <Area
          dataKey="range50"
          stroke="none"
          fill="#6366f1"
          fillOpacity={areaOpacity("range50", 0.24)}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="median"
          stroke="#4f46e5"
          strokeWidth={highlight === "median" ? 4 : 2.5}
          strokeOpacity={lineOpacity("median")}
          dot={false}
          activeDot={{ r: 4, fill: "#4f46e5", stroke: "#fff", strokeWidth: 1.5 }}
          isAnimationActive={false}
        />
        <Line
          dataKey="contributed"
          stroke="#64748b"
          strokeWidth={highlight === "contributed" ? 2.5 : 1.5}
          strokeOpacity={lineOpacity("contributed")}
          strokeDasharray="5 4"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        {phaseBoundaryYear != null && (
          <ReferenceLine
            x={phaseBoundaryYear}
            stroke="currentColor"
            className="text-zinc-400 dark:text-zinc-500"
            strokeDasharray="4 4"
            label={
              phaseBoundaryLabel
                ? {
                    value: phaseBoundaryLabel,
                    position: "insideTopRight",
                    className: "fill-zinc-500 dark:fill-zinc-400",
                    fontSize: 11,
                  }
                : undefined
            }
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

interface BandRow {
  year: number;
  contributed: number;
  // True (unfloored) values — the plotted `median`/`range50`/`range80`/
  // `rangeFull` fields may be floored for the log-scale axis (see `data`
  // above), but the tooltip must always show the real numbers, including
  // real 0s from depleted runs.
  medianRaw: number;
  range50Raw: [number, number];
  range80Raw: [number, number];
  rangeFullRaw: [number, number];
}

function ChartTooltip({
  active,
  payload,
  fmtVal,
  t,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: BandRow }>;
  fmtVal: (n: number) => string;
  t: (k: MessageKey) => string;
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  const range = (r: [number, number]) => `${fmtVal(r[0])} - ${fmtVal(r[1])}`;
  return (
    <div className="min-w-[15rem] rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">
        {t("sim.year")} {d.year}
      </div>
      <Line2 color="#4f46e5" label={t("sim.medianLine")} value={fmtVal(d.medianRaw)} strong />
      <Line2 color="#6366f1" label={t("sim.band50")} value={range(d.range50Raw)} />
      <Line2 color="#6366f1" label={t("sim.band80")} value={range(d.range80Raw)} opacity={0.7} />
      <Line2 color="#6366f1" label={t("sim.bandFull")} value={range(d.rangeFullRaw)} opacity={0.45} />
      <Line2 color="#64748b" label={t("sim.contributedLine")} value={fmtVal(d.contributed)} dashed />
    </div>
  );
}

function Line2({
  color,
  label,
  value,
  strong = false,
  dashed = false,
  opacity = 1,
}: {
  color: string;
  label: string;
  value: string;
  strong?: boolean;
  dashed?: boolean;
  opacity?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
        <span
          className="inline-block h-2.5 w-2.5 rounded-[2px]"
          style={
            dashed
              ? { borderTop: `2px dashed ${color}`, width: "0.85rem", height: 0 }
              : { backgroundColor: color, opacity }
          }
        />
        {label}
      </span>
      <span className={`tabular-nums ${strong ? "font-semibold text-zinc-900 dark:text-zinc-100" : ""}`}>
        {value}
      </span>
    </div>
  );
}
