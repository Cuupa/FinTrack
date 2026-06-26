"use client";

// Reusable line chart for net-worth and per-asset price series. Supports the
// PRD chart controls: linear/log y-scale and absolute(currency)/relative(%)
// display, plus optional buy/sell event markers on the timeline.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesPoint } from "@/lib/finance/portfolio";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format";

export type ChartScale = "linear" | "log";
export type ChartMode = "currency" | "percent";

export interface ChartMarker {
  date: string;
  type: "BUY" | "SELL";
}

interface Props {
  series: SeriesPoint[];
  scale: ChartScale;
  mode: ChartMode;
  currency: string;
  markers?: ChartMarker[];
  height?: number;
  color?: string;
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  }).format(new Date(iso + "T00:00:00"));
}

export function PerformanceChart({
  series,
  scale,
  mode,
  currency,
  markers = [],
  height = 320,
  color = "#10b981",
}: Props) {
  // Baseline for percentage mode: first strictly-positive value.
  const baseline = series.find((p) => p.value > 0)?.value ?? 0;

  const data = series.map((p) => ({
    date: p.date,
    value:
      mode === "percent"
        ? baseline > 0
          ? p.value / baseline - 1
          : 0
        : p.value,
  }));

  // Log scale is only meaningful for positive absolute values.
  const useLog = scale === "log" && mode === "currency";

  // Snap each marker to the nearest sampled date so ReferenceLine aligns with
  // the categorical x-axis.
  const seriesDates = series.map((p) => p.date);
  const snappedMarkers = markers
    .map((m) => ({ ...m, date: nearest(seriesDates, m.date) }))
    .filter((m) => m.date !== null) as ChartMarker[];

  const formatY = (v: number) =>
    mode === "percent" ? formatPercent(v, 0) : formatCompactCurrency(v, currency);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          minTickGap={48}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-zinc-400"
        />
        <YAxis
          scale={useLog ? "log" : "linear"}
          domain={useLog ? ["auto", "auto"] : ["auto", "auto"]}
          allowDataOverflow={useLog}
          tickFormatter={formatY}
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
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value) => {
            const v = Number(value);
            return [
              mode === "percent" ? formatPercent(v) : formatCurrency(v, currency),
              mode === "percent" ? "Return" : "Value",
            ];
          }}
        />
        {snappedMarkers.map((m, i) => (
          <ReferenceLine
            key={`${m.date}-${i}`}
            x={m.date}
            stroke={m.type === "BUY" ? "#10b981" : "#ef4444"}
            strokeDasharray="4 2"
            strokeOpacity={0.7}
          />
        ))}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function nearest(dates: string[], target: string): string | null {
  if (dates.length === 0) return null;
  let best = dates[0];
  let bestDiff = Infinity;
  for (const d of dates) {
    const diff = Math.abs(
      new Date(d).getTime() - new Date(target).getTime(),
    );
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}
