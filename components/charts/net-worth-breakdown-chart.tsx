"use client";

// The overview's net-worth chart (spec §9): net worth split into the two sides
// it is made of -- everything owned (assets) against everything owed
// (liabilities) -- plus the net line itself. A single net line hid that the
// total can be deeply negative behind a mortgage; three lines and a zero
// baseline make the negative total legible, which is the whole point of the
// change. No benchmarks and no return %: those compare a depot, and net worth
// carries cash and debt an index does not.

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
import type { NetWorthBreakdownPoint } from "@/lib/finance/portfolio";
import { formatCurrency } from "@/lib/format";
import { intlLocale } from "@/lib/i18n/locale";
import { niceTicks } from "@/lib/ticks";
import { axisCurrencyFormatter, yAxisWidth } from "./axis";

const ASSETS_COLOR = "#10b981"; // emerald: what you own
const LIABILITIES_COLOR = "#ef4444"; // red: what you owe

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    month: "short",
    day: "numeric",
    year: "2-digit",
  }).format(new Date(iso + "T00:00:00"));
}

interface Props {
  points: NetWorthBreakdownPoint[];
  currency: string;
  height?: number;
  ariaLabel?: string;
  labels: { net: string; assets: string; liabilities: string };
}

export function NetWorthBreakdownChart({
  points,
  currency,
  height = 320,
  ariaLabel,
  labels,
}: Props) {
  const data = points.map((p) => ({
    date: p.date,
    net: p.net,
    assets: p.assets,
    liabilities: p.liabilities,
  }));

  // Clean 0/5-ending ticks spanning every line, so the axis covers the deepest
  // liability and the highest asset alike and the zero line always lands on one.
  const nums: number[] = [];
  for (const d of data) nums.push(d.net, d.assets, d.liabilities);
  const ticks = nums.length ? niceTicks(Math.min(...nums, 0), Math.max(...nums, 0)) : undefined;
  const linearTicks = ticks && ticks.length >= 2 ? ticks : undefined;
  const axisNums = linearTicks ?? nums;

  const formatTick = axisCurrencyFormatter(axisNums, currency);
  const yWidth = yAxisWidth(axisNums.map(formatTick));

  return (
    <div>
      <div role="img" aria-label={ariaLabel} data-private-axis="">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
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
              domain={
                linearTicks ? [linearTicks[0], linearTicks[linearTicks.length - 1]] : ["auto", "auto"]
              }
              ticks={linearTicks}
              tickFormatter={formatTick}
              width={yWidth}
              tick={{ fontSize: 12 }}
              stroke="currentColor"
              className="text-zinc-400"
            />
            {/* The zero baseline: net worth crossing it is what a single line hid. */}
            <ReferenceLine y={0} className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth={1} />
            <Tooltip
              cursor={{ stroke: "rgba(120,120,120,0.35)", strokeWidth: 1 }}
              content={({ active, payload, label }) => (
                <BreakdownTooltip
                  active={active}
                  payload={payload as ReadonlyArray<TooltipEntry> | undefined}
                  label={label as string}
                  currency={currency}
                />
              )}
            />
            <Line
              type="monotone"
              dataKey="assets"
              name={labels.assets}
              stroke={ASSETS_COLOR}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="liabilities"
              name={labels.liabilities}
              stroke={LIABILITIES_COLOR}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
            {/* Net is the headline, so it is the boldest line and painted last to
                sit on top. It rides currentColor so it stays legible in both
                themes (dark ink on light, light ink on dark). */}
            <Line
              type="monotone"
              dataKey="net"
              name={labels.net}
              stroke="currentColor"
              className="text-zinc-800 dark:text-zinc-100"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-500">
        <LegendItem className="bg-zinc-800 dark:bg-zinc-100" label={labels.net} />
        <LegendItem color={ASSETS_COLOR} label={labels.assets} />
        <LegendItem color={LIABILITIES_COLOR} label={labels.liabilities} />
      </div>
    </div>
  );
}

function LegendItem({
  label,
  color,
  className = "",
}: {
  label: string;
  color?: string;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-[2px] ${className}`}
        style={color ? { backgroundColor: color } : undefined}
      />
      {label}
    </span>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number | string | null;
  color?: string;
  stroke?: string;
}

function BreakdownTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: string;
  currency: string;
}) {
  const rows = (payload ?? []).filter((p) => p.value != null);
  if (!active || rows.length === 0) return null;
  return (
    <div className="min-w-[12rem] rounded-md border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
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
            {formatCurrency(Number(r.value), currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
