"use client";

// Returns tab: contribution-adjusted period returns as a heatmap and bar chart
// (quarter or year), plus a "performance map" treemap of current holdings
// sized by value and coloured by return.

import { Fragment, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { netWorthSeries, summarizeAll } from "@/lib/finance/portfolio";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { netFlows, periodReturns, type Period } from "@/lib/finance/returns";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/info-tip";

const EMERALD = "#10b981";
const RED = "#ef4444";

/** Background colour for a return cell — green/red, intensity by magnitude. */
function heatColor(ret: number): string {
  const mag = Math.min(1, Math.abs(ret) / 0.2); // saturate at ±20%
  const a = 0.12 + 0.6 * mag;
  return ret >= 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`;
}

export function ReturnsView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const base = data.profile.currency;
  const [period, setPeriod] = useState<Period>("quarter");

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation).filter(
        (h) => h.position.shares > 0,
      ),
    [data.assets, data.transactions, valuation],
  );

  const histItems = useMemo(
    () =>
      data.assets
        .map(quoteItemFor)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories } = useHistory(histItems, "MAX", base);

  const series = useMemo(
    () => netWorthSeries(data.assets, data.transactions, "MAX", valuation, histories),
    [data.assets, data.transactions, valuation, histories],
  );
  const flows = useMemo(
    () => netFlows(data.assets, data.transactions, valuation),
    [data.assets, data.transactions, valuation],
  );
  const returns = useMemo(() => periodReturns(series, flows, period), [series, flows, period]);

  const barData = useMemo(
    () =>
      returns.map((r) => ({
        label: period === "year" ? r.label : `${String(r.year).slice(2)} ${r.label}`,
        pct: r.ret * 100,
      })),
    [returns, period],
  );

  const years = useMemo(
    () => Array.from(new Set(returns.map((r) => r.year))).sort((a, b) => b - a),
    [returns],
  );

  const tree = useMemo(
    () =>
      holdings
        .map((h) => ({
          name: h.asset.symbol || h.asset.name,
          size: Math.max(0, h.marketValue),
          ret: h.unrealizedPLPercent,
        }))
        .filter((d) => d.size > 0),
    [holdings],
  );

  if (holdings.length === 0) {
    return (
      <Card>
        <p className="text-sm text-zinc-500">Add holdings to see your returns.</p>
      </Card>
    );
  }

  const cellFor = (year: number, q: number) =>
    returns.find((r) => r.year === year && r.quarter === q);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            Returns
            <InfoTip text="Period returns adjusted for deposits/withdrawals (modified Dietz), so adding money doesn't show up as a gain." />
          </h2>
          <SegmentedControl<Period>
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[
              { label: "Quarter", value: "quarter" },
              { label: "Year", value: "year" },
            ]}
          />
        </div>

        {/* Heatmap */}
        <div className="mt-4 overflow-x-auto">
          {period === "quarter" ? (
            <div
              className="inline-grid min-w-full gap-1 text-xs"
              style={{ gridTemplateColumns: "auto repeat(4, minmax(3.5rem, 1fr))" }}
            >
              <div />
              {["Q1", "Q2", "Q3", "Q4"].map((q) => (
                <div key={q} className="px-1 text-center font-medium text-zinc-500">
                  {q}
                </div>
              ))}
              {years.map((y) => (
                <Fragment key={y}>
                  <div className="flex items-center pr-2 font-medium text-zinc-500">{y}</div>
                  {[0, 1, 2, 3].map((q) => {
                    const r = cellFor(y, q);
                    return (
                      <div
                        key={q}
                        className="rounded-md px-1 py-2 text-center tabular-nums"
                        style={{ backgroundColor: r ? heatColor(r.ret) : undefined }}
                      >
                        {r ? formatPercent(r.ret, 1) : "·"}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...returns].reverse().map((r) => (
                <div
                  key={r.key}
                  className="min-w-[5.5rem] rounded-lg px-4 py-3 text-center"
                  style={{ backgroundColor: heatColor(r.ret) }}
                >
                  <div className="text-xs font-semibold text-zinc-100">{r.year}</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-white">
                    {formatPercent(r.ret, 1)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Return by {period}</h3>
          <SegmentedControl<Period>
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[
              { label: "Quarter", value: "quarter" },
              { label: "Year", value: "year" },
            ]}
          />
        </div>
        <div className="mt-3">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" className="text-zinc-400" />
              <YAxis
                tickFormatter={(v) => `${v.toFixed(0)}%`}
                width={44}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-zinc-400"
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid rgba(120,120,120,0.3)", fontSize: 13 }}
                formatter={(v) => [`${Number(v).toFixed(2)}%`, "Return"]}
              />
              <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={d.pct >= 0 ? EMERALD : RED} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          Performance map
          <InfoTip text="Each holding sized by its current value and coloured by its unrealised return (green = up, red = down)." />
        </h3>
        <div className="mt-3">
          <ResponsiveContainer width="100%" height={320}>
            <Treemap data={tree} dataKey="size" stroke="#fff" isAnimationActive={false} content={<PerfCell />}>
              <Tooltip content={<MapTooltip currency={base} />} />
            </Treemap>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

interface CellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  ret?: number;
}

function PerfCell({ x = 0, y = 0, width = 0, height = 0, name = "", ret = 0 }: CellProps) {
  if (width <= 0 || height <= 0) return null;
  const cx = x + width / 2;
  const cy = y + height / 2;
  // Font scales with the tile; SVG text doesn't wrap, so truncate to fit width.
  const base = Math.max(9, Math.min(22, Math.floor(Math.min(width / 4.5, height / 3.5))));
  const maxChars = Math.max(2, Math.floor(width / (base * 0.62)));
  const label = name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name;
  const showPct = height > base * 2.6;
  const textStyle = { paintOrder: "stroke", stroke: "rgba(0,0,0,0.4)", strokeWidth: 2.5 } as const;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill: heatColor(ret), stroke: "#0a0a0a", strokeOpacity: 0.3 }} />
      {width >= 24 && height >= 18 && (
        <text x={cx} textAnchor="middle" fill="#ffffff" style={textStyle}>
          <tspan x={cx} y={showPct ? cy - base * 0.15 : cy + base * 0.35} fontSize={base} fontWeight={700}>
            {label}
          </tspan>
          {showPct && (
            <tspan x={cx} dy={base * 1.05} fontSize={base * 0.78} fontWeight={500} fillOpacity={0.92}>
              {formatPercent(ret, 1)}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
}

interface MapTooltipProps {
  currency: string;
  active?: boolean;
  payload?: Array<{ payload?: { name?: string; size?: number; ret?: number } }>;
}

function MapTooltip({ currency, active, payload }: MapTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</div>
      <div className="mt-0.5 text-zinc-500">
        {formatCurrency(p.size ?? 0, currency)} · {formatPercent(p.ret ?? 0)}
      </div>
    </div>
  );
}
