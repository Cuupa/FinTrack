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
import { formatCompactCurrency, formatCurrency } from "@/lib/format";

export function DistributionChart({
  result,
  currency,
  height = 360,
}: {
  result: MonteCarloResult;
  currency: string;
  height?: number;
}) {
  const data = result.bands.map((b) => ({
    year: b.year,
    rangeFull: [b.worst, b.best] as [number, number],
    range80: [b.p10, b.p90] as [number, number],
    range50: [b.p25, b.p75] as [number, number],
    median: b.median,
    contributed: b.contributed,
  }));

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
          tickFormatter={(v) => formatCompactCurrency(v, currency)}
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
            const fmt = (n: number) => formatCurrency(Number(n), currency);
            const label = LABELS[String(name)] ?? String(name);
            if (Array.isArray(value)) {
              return [`${fmt(value[0])} – ${fmt(value[1])}`, label];
            }
            return [fmt(Number(value)), label];
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
