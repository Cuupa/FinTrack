"use client";

// Probability-fan chart for the Monte Carlo simulation (PRD §3.3): shaded
// percentile bands (worst→best, 10–90, 25–75) with the median line and the
// total-contributed reference line.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
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

export function DistributionChart({
  result,
  currency,
  scale = "linear",
  mode = "currency",
  height = 360,
  highlight = null,
}: {
  result: MonteCarloResult;
  currency: string;
  scale?: ChartScale;
  mode?: ChartMode;
  height?: number;
  /** Series key to emphasise (others dim) — driven by legend hover. */
  highlight?: string | null;
}) {
  const { t } = useI18n();
  // Per-series opacity helpers for the legend-hover highlight.
  const areaOpacity = (key: string, base: number) =>
    highlight == null ? base : highlight === key ? Math.min(0.6, base * 2.2) : base * 0.3;
  const lineOpacity = (key: string) => (highlight == null || highlight === key ? 1 : 0.2);
  // Percent mode expresses each band as growth over what was contributed by
  // that year, so the contributed line is a flat 0% baseline.
  const pct = (v: number, c: number) => (c > 0 ? v / c - 1 : 0);
  const data = result.bands.map((b) =>
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

  // Log scale is only meaningful for positive absolute values (currency mode).
  const useLog = scale === "log" && mode === "currency";
  const positives = data
    .flatMap((d) => [d.median, ...d.rangeFull, ...d.range80, ...d.range50])
    .filter((v) => v > 0);
  const logLo = positives.length ? Math.min(...positives) : 1;
  const logHi = positives.length ? Math.max(...positives) : 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <XAxis
          dataKey="year"
          tickFormatter={(y) => `${y}y`}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-zinc-400"
        />
        <YAxis
          scale={useLog ? "log" : "linear"}
          domain={useLog ? [logLo, logHi] : ["auto", "auto"]}
          allowDataOverflow={useLog}
          // Full values (no K/Tsd. abbreviation) so it reads consistently across
          // locales.
          tickFormatter={(v) => (mode === "percent" ? formatPercent(v, 0) : formatCurrency(v, currency))}
          width={104}
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
      </ComposedChart>
    </ResponsiveContainer>
  );
}

interface BandRow {
  year: number;
  median: number;
  contributed: number;
  range50: [number, number];
  range80: [number, number];
  rangeFull: [number, number];
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
  const range = (r: [number, number]) => `${fmtVal(r[0])} – ${fmtVal(r[1])}`;
  return (
    <div className="min-w-[15rem] rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">
        {t("sim.year")} {d.year}
      </div>
      <Line2 color="#4f46e5" label={t("sim.medianLine")} value={fmtVal(d.median)} strong />
      <Line2 color="#6366f1" label={t("sim.band50")} value={range(d.range50)} />
      <Line2 color="#6366f1" label={t("sim.band80")} value={range(d.range80)} opacity={0.7} />
      <Line2 color="#6366f1" label={t("sim.bandFull")} value={range(d.rangeFull)} opacity={0.45} />
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
