"use client";

// Reusable line chart for net-worth and per-asset price series. Supports the
// PRD chart controls: linear/log y-scale and absolute(currency)/relative(%)
// display, buy/sell/dividend markers, and optional benchmark overlays — which
// render every line normalised to % from the window start.

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
import { useI18n } from "@/lib/i18n/i18n-context";
import { InfoTip } from "@/components/ui/info-tip";

export type ChartScale = "linear" | "log";
export type ChartMode = "currency" | "percent";

export interface ChartMarker {
  date: string;
  type: "BUY" | "SELL" | "DIV";
}

export interface CompareSeries {
  label: string;
  color: string;
  points: SeriesPoint[];
}

const MARKER_COLOR: Record<ChartMarker["type"], string> = {
  BUY: "#10b981",
  SELL: "#ef4444",
  DIV: "#f59e0b",
};

const MARKER_GLYPH: Record<ChartMarker["type"], string> = {
  BUY: "▲",
  SELL: "▼",
  DIV: "●",
};

// A map-style pin dropped at the top of the chart for a buy/sell/dividend event:
// a small coloured head with the event glyph and a short stem, replacing the old
// full-height dotted reference line.
function PinLabel(props: {
  viewBox?: { x?: number; y?: number };
  color: string;
  glyph: string;
  active?: boolean;
  dimmed?: boolean;
}) {
  const { viewBox, color, glyph, active, dimmed } = props;
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const r = active ? 8 : 6.5;
  const opacity = dimmed ? 0.2 : 1;
  return (
    <g transform={`translate(${x}, ${y})`} opacity={opacity}>
      <line x1={0} y1={r} x2={0} y2={r + 10} stroke={color} strokeWidth={active ? 2 : 1.3} />
      <circle cx={0} cy={0} r={r} fill={color} stroke="white" strokeWidth={1} />
      <text
        x={0}
        y={0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={active ? 9 : 8}
        fill="white"
      >
        {glyph}
      </text>
    </g>
  );
}

interface Props {
  series: SeriesPoint[];
  scale: ChartScale;
  mode: ChartMode;
  currency: string;
  markers?: ChartMarker[];
  height?: number;
  color?: string;
  /** Benchmark overlays; when present everything is shown normalised to %. */
  compare?: CompareSeries[];
  /** Legend label for the main line when comparing. */
  mainLabel?: string;
  /** Cumulative-return fractions (aligned to `series` by index) used as the main
   *  line in percent mode instead of normalising the value series. */
  returnSeries?: SeriesPoint[];
  /** Emphasise markers of this type (others dim); null = all normal. */
  highlightType?: ChartMarker["type"] | null;
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  }).format(new Date(iso + "T00:00:00"));
}

/** Last value at or before a date in an ascending series (null before it). */
// Value of a (possibly sparse) series at an arbitrary date. Benchmarks are
// stored weekly, so a plain step lookup makes the overlay render as a staircase
// against the daily portfolio line. Linearly interpolate between the two points
// straddling `iso` so the benchmark curve is smooth.
function valueAt(points: SeriesPoint[], iso: string): number | null {
  if (points.length === 0 || iso < points[0].date) return null;
  // Binary search for the last index whose date <= iso.
  let lo = 0;
  let hi = points.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= iso) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const a = points[idx];
  const b = points[idx + 1];
  if (!b || a.date === iso) return a.value;
  const t0 = Date.parse(a.date);
  const t1 = Date.parse(b.date);
  const ti = Date.parse(iso);
  if (!(t1 > t0)) return a.value;
  const f = (ti - t0) / (t1 - t0);
  return a.value + (b.value - a.value) * f;
}

export function PerformanceChart({
  series,
  scale,
  mode,
  currency,
  markers = [],
  height = 320,
  color = "#10b981",
  compare = [],
  mainLabel = "Value",
  highlightType = null,
  returnSeries,
}: Props) {
  const { t } = useI18n();
  const comparing = compare.length > 0;
  // Comparison is only meaningful as relative performance.
  const pctMode = comparing || mode === "percent";
  // In return mode the main line is the cumulative return (TWROR), not the value
  // — so don't keep calling it "Net worth".
  const mainName = returnSeries && pctMode ? "Return" : mainLabel;

  // Baselines: main = first positive value; each benchmark = its value at the
  // window start (so all lines begin at 0%).
  const baseMain = series.find((p) => p.value > 0)?.value ?? 0;
  const firstDate = series[0]?.date;
  const baseB = compare.map((c) => {
    const at = firstDate ? valueAt(c.points, firstDate) : null;
    return at && at > 0 ? at : (c.points.find((p) => p.value > 0)?.value ?? 0);
  });

  const data = series.map((p, i) => {
    // In percent mode prefer a precomputed cumulative-return series (deposits
    // excluded); otherwise normalise the value against the window start.
    const pctValue = returnSeries
      ? (returnSeries[i]?.value ?? 0)
      : baseMain > 0
        ? p.value / baseMain - 1
        : 0;
    const row: Record<string, number | string | null> = {
      date: p.date,
      value: pctMode ? pctValue : p.value,
    };
    compare.forEach((c, i) => {
      const v = valueAt(c.points, p.date);
      row[`b${i}`] = v != null && baseB[i] > 0 ? v / baseB[i] - 1 : null;
    });
    return row;
  });

  const useLog = scale === "log" && !pctMode;
  const positives = data
    .map((d) => d.value)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const logLo = positives.length ? Math.min(...positives) : 1;
  const logHi = positives.length ? Math.max(...positives) : 1;

  const seriesDates = series.map((p) => p.date);
  const snappedMarkers = markers
    .map((m) => ({ ...m, date: nearest(seriesDates, m.date) }))
    .filter((m) => m.date !== null) as ChartMarker[];

  const formatY = (v: number) =>
    pctMode ? formatPercent(v, 0) : formatCompactCurrency(v, currency);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: 8 }}>
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
            domain={useLog ? [logLo, logHi] : ["auto", "auto"]}
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
            formatter={(value, name) => {
              if (value == null) return ["—", name as string];
              const v = Number(value);
              return [pctMode ? formatPercent(v) : formatCurrency(v, currency), name as string];
            }}
          />
          {snappedMarkers.map((m, i) => {
            const dimmed = highlightType != null && m.type !== highlightType;
            const active = highlightType != null && m.type === highlightType;
            // The indicator is a pin at the top; only show a faint guide line
            // when its type is highlighted, so the chart stays clean otherwise.
            return (
              <ReferenceLine
                key={`${m.date}-${i}`}
                x={m.date}
                stroke={MARKER_COLOR[m.type]}
                strokeWidth={active ? 1.5 : 1}
                strokeOpacity={active ? 0.35 : 0}
                label={
                  <PinLabel
                    color={MARKER_COLOR[m.type]}
                    glyph={MARKER_GLYPH[m.type]}
                    active={active}
                    dimmed={dimmed}
                  />
                }
              />
            );
          })}
          <Line
            type="monotone"
            dataKey="value"
            name={mainName}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {compare.map((c, i) => (
            <Line
              key={c.label}
              type="monotone"
              dataKey={`b${i}`}
              name={c.label}
              stroke={c.color}
              strokeWidth={1.5}
              strokeOpacity={0.85}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {comparing && (
        <div className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-zinc-400">
          <InfoTip text={t("compare.hintFull")} />
          {t("compare.hint")}
        </div>
      )}
    </div>
  );
}

function nearest(dates: string[], target: string): string | null {
  if (dates.length === 0) return null;
  let best = dates[0];
  let bestDiff = Infinity;
  for (const d of dates) {
    const diff = Math.abs(new Date(d).getTime() - new Date(target).getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}
