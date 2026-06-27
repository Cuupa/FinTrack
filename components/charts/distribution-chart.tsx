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
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format";
import type { ChartMode, ChartScale } from "./performance-chart";

export function DistributionChart({
  result,
  currency,
  scale = "linear",
  mode = "currency",
  height = 360,
}: {
  result: MonteCarloResult;
  currency: string;
  scale?: ChartScale;
  mode?: ChartMode;
  height?: number;
}) {
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
          tickFormatter={(v) =>
            mode === "percent" ? formatPercent(v, 0) : formatCompactCurrency(v, currency)
          }
          width={72}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-zinc-400"
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: "1px solid rgba(120,120,120,0.3)",
            fontSize: 13,
          }}
          labelFormatter={(y) => `Year ${y}`}
          formatter={(value, name) => {
            const label = LABELS[String(name)] ?? String(name);
            if (Array.isArray(value)) {
              return [`${fmtVal(value[0])} – ${fmtVal(value[1])}`, label];
            }
            return [fmtVal(Number(value)), label];
          }}
        />
        <Area
          dataKey="rangeFull"
          stroke="none"
          fill="#6366f1"
          fillOpacity={0.08}
          isAnimationActive={false}
        />
        <Area
          dataKey="range80"
          stroke="none"
          fill="#6366f1"
          fillOpacity={0.16}
          isAnimationActive={false}
        />
        <Area
          dataKey="range50"
          stroke="none"
          fill="#6366f1"
          fillOpacity={0.24}
          isAnimationActive={false}
        />
        <Line
          dataKey="median"
          stroke="#4f46e5"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="contributed"
          stroke="#64748b"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const LABELS: Record<string, string> = {
  rangeFull: "Worst–Best",
  range80: "10th–90th pct",
  range50: "25th–75th pct",
  median: "Median",
  contributed: "Contributed",
};
