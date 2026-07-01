"use client";

// Reusable line chart for net-worth and per-asset price series. Supports the
// PRD chart controls: linear/log y-scale and absolute(currency)/relative(%)
// display, buy/sell/dividend markers, and optional benchmark overlays — which
// render every line normalised to % from the window start.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
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
  type: "BUY" | "SELL" | "DIV" | "BOOKING";
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
  BOOKING: "#6366f1",
};

const MARKER_GLYPH: Record<ChartMarker["type"], string> = {
  BUY: "▲",
  SELL: "▼",
  DIV: "●",
  BOOKING: "★",
};

// A map-style pin whose tip sits ON the line at the event's data point: a small
// coloured head with the event glyph and a pointer tapering down to the price.
// Recharts injects cx/cy (the pixel position of the ReferenceDot).
function PinShape(props: {
  cx?: number;
  cy?: number;
  color: string;
  glyph: string;
  active?: boolean;
  dimmed?: boolean;
}) {
  const { cx = 0, cy = 0, color, glyph, active, dimmed } = props;
  const r = active ? 8 : 6.5;
  const headY = cy - (r + 7); // circle centre, above the data point
  const opacity = dimmed ? 0.25 : 1;
  return (
    <g opacity={opacity}>
      {/* pointer from the head down to the exact data point */}
      <path
        d={`M ${cx} ${cy} L ${cx - 3.2} ${headY + r - 1.5} L ${cx + 3.2} ${headY + r - 1.5} Z`}
        fill={color}
      />
      <circle cx={cx} cy={headY} r={r} fill={color} stroke="white" strokeWidth={1.2} />
      <text
        x={cx}
        y={headY + 0.5}
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
  // The y-value of the plotted line at each date, so markers can sit ON the line.
  const valueByDate = new Map<string, number>();
  for (const row of data) {
    if (typeof row.value === "number") valueByDate.set(row.date as string, row.value);
  }
  const snappedMarkers = markers
    .map((m) => ({ ...m, date: nearest(seriesDates, m.date) }))
    .filter((m) => m.date !== null) as ChartMarker[];

  const formatY = (v: number) =>
    pctMode ? formatPercent(v, 0) : formatCompactCurrency(v, currency);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 8 }}>
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
            cursor={{ stroke: "rgba(120,120,120,0.35)", strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                payload={payload as ReadonlyArray<TooltipEntry> | undefined}
                label={label as string}
                pctMode={pctMode}
                currency={currency}
              />
            )}
          />
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
          {/* Pins paint last so they sit on top of the line. */}
          {snappedMarkers.map((m, i) => {
            const y = valueByDate.get(m.date);
            if (y == null) return null;
            const dimmed = highlightType != null && m.type !== highlightType;
            const active = highlightType != null && m.type === highlightType;
            // A pin whose tip sits on the line at the transaction/dividend point.
            return (
              <ReferenceDot
                key={`${m.date}-${i}`}
                x={m.date}
                y={y}
                r={0}
                shape={
                  <PinShape
                    color={MARKER_COLOR[m.type]}
                    glyph={MARKER_GLYPH[m.type]}
                    active={active}
                    dimmed={dimmed}
                  />
                }
              />
            );
          })}
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

interface TooltipEntry {
  name?: string;
  value?: number | string | null;
  color?: string;
  stroke?: string;
}

// Tooltip styled to match the simulation chart: a dated header, then one row per
// series with a colour swatch, label and right-aligned value.
function ChartTooltip({
  active,
  payload,
  label,
  pctMode,
  currency,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: string;
  pctMode: boolean;
  currency: string;
}) {
  const rows = (payload ?? []).filter((p) => p.value != null);
  if (!active || rows.length === 0) return null;
  const fmt = (v: number) => (pctMode ? formatPercent(v) : formatCurrency(v, currency));
  return (
    <div className="min-w-[12rem] rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">
        {label ? shortDate(String(label)) : ""}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: r.color || r.stroke || "#10b981" }}
            />
            {r.name}
          </span>
          <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
            {fmt(Number(r.value))}
          </span>
        </div>
      ))}
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
