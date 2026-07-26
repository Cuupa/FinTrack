"use client";

// Visualisation for the payoff plan (ROADMAP #9, flag `debtPayoff`). A table
// of payoff dates says nothing about the shape of a 40-year mortgage: what a
// user needs to see is the balance falling, where the fixed-rate period ends,
// and how much of each year's money is interest rather than principal (owner
// rule, round 26 -- "ich sehe nicht wie sich über die zeit die
// verbindlichkeiten verändern").
//
// Purely presentational: every figure comes from `planPayoff`/`yearlySplit`
// (lib/finance/debt.ts, pure) already converted to the base currency by the
// caller, exactly like `ForecastCard` consumes `plannedForecast`.

import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DebtPlanPoint, DebtYear } from "@/lib/finance/debt";
import { formatCurrency } from "@/lib/format";
import { axisCurrencyFormatter, yAxisWidth } from "@/components/charts/axis";
import { useI18n } from "@/lib/i18n/i18n-context";

/** Same palette as the allocation pie, so one debt keeps one colour across
 *  the page's charts. */
const PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
];
const BASELINE = "#a1a1aa";
const INTEREST = "#f43f5e";
const PRINCIPAL = "#10b981";

export interface DebtSeriesLegend {
  id: string;
  name: string;
}

/** A dated annotation on the balance chart (end of a fixed-rate period). */
export interface DebtMarker {
  date: string;
  label: string;
}

export function debtColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/** "2036-08-01" → "2036"; the axis is decades long, so the year is the unit. */
function yearOf(iso: string): string {
  return iso.slice(0, 4);
}

/**
 * Remaining balance month by month: one stacked area per debt, so both the
 * total and the order the individual debts disappear in are readable at a
 * glance. `baseline` (the same plan on minimum payments only) is drawn as a
 * dashed line whenever it differs, which is what makes an extra payment's
 * effect visible rather than a number the user has to take on trust.
 */
export function DebtBalanceChart({
  series,
  baseline,
  debts,
  base,
  markers = [],
}: {
  series: DebtPlanPoint[];
  baseline?: DebtPlanPoint[];
  debts: DebtSeriesLegend[];
  base: string;
  markers?: DebtMarker[];
}) {
  const { t } = useI18n();

  const data = useMemo(() => {
    const baselineByMonth = new Map((baseline ?? []).map((p) => [p.month, p.balance]));
    // The dashed baseline outlives the (shorter) accelerated plan, so the
    // chart runs to whichever ends later -- otherwise the comparison is cut
    // off exactly where it gets interesting.
    const last = Math.max(series.length - 1, (baseline?.length ?? 1) - 1);
    const rows: Record<string, string | number>[] = [];
    for (let m = 0; m <= last; m++) {
      const inPlan = m < series.length;
      const p = series[Math.min(m, series.length - 1)];
      const row: Record<string, string | number> = {
        // Past its own payoff the accelerated plan owes nothing; carrying the
        // final month forward would draw a flat tail at the last balance.
        date: inPlan ? p.date : baseline![m].date,
        ...Object.fromEntries(debts.map((d) => [d.id, inPlan ? (p.byDebt[d.id] ?? 0) : 0])),
      };
      if (baseline?.length) row.baseline = baselineByMonth.get(m) ?? 0;
      rows.push(row);
    }
    return rows;
  }, [series, baseline, debts]);

  const tickValues = useMemo(() => {
    const totals = series.map((p) => p.balance);
    return baseline?.length ? [...totals, ...baseline.map((p) => p.balance)] : totals;
  }, [series, baseline]);
  const tickFormatter = axisCurrencyFormatter(tickValues, base);
  const axisWidth = yAxisWidth(tickValues.map((v) => tickFormatter(v)));
  // ~10 year labels regardless of term length: a 40-year plan has 490 points.
  const tickInterval = Math.max(1, Math.round(data.length / 10 / 12) * 12);
  const hasBaseline = Boolean(baseline?.length);

  return (
    <div className="mt-4 h-72" role="img" aria-label={t("debt.chart.aria")}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-800"
          />
          <XAxis
            dataKey="date"
            tickFormatter={yearOf}
            interval={tickInterval}
            tick={{ fontSize: 12 }}
            minTickGap={16}
          />
          <YAxis width={axisWidth} tickFormatter={tickFormatter} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v, name) => [formatCurrency(Number(v), base), name]}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {debts.map((d, i) => (
            <Area
              key={d.id}
              type="monotone"
              dataKey={d.id}
              name={d.name}
              stackId="debt"
              stroke={debtColor(i)}
              fill={debtColor(i)}
              fillOpacity={0.35}
              isAnimationActive={false}
            />
          ))}
          {hasBaseline && (
            <Line
              type="monotone"
              dataKey="baseline"
              name={t("debt.chart.baseline")}
              stroke={BASELINE}
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {markers.map((m) => (
            <ReferenceLine
              key={`${m.date}-${m.label}`}
              x={m.date}
              stroke={BASELINE}
              strokeDasharray="2 4"
              label={{ value: m.label, position: "insideTopRight", fontSize: 11, fill: BASELINE }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Where each year's money actually went. On a mortgage the first years are
 * almost entirely interest, which is the single most useful thing a payoff
 * page can tell someone -- and it is invisible in a payoff-date table.
 */
export function DebtSplitChart({ years, base }: { years: DebtYear[]; base: string }) {
  const { t } = useI18n();

  const tickValues = useMemo(
    () => years.map((y) => y.interest + Math.max(0, y.principal)),
    [years],
  );
  const tickFormatter = axisCurrencyFormatter(tickValues, base);
  const axisWidth = yAxisWidth(tickValues.map((v) => tickFormatter(v)));

  return (
    <div className="mt-4 h-60" role="img" aria-label={t("debt.chart.splitAria")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={years} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-800"
          />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} minTickGap={12} />
          <YAxis width={axisWidth} tickFormatter={tickFormatter} tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v, name) => [formatCurrency(Number(v), base), name]}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="principal"
            name={t("debt.chart.principal")}
            stackId="split"
            fill={PRINCIPAL}
            isAnimationActive={false}
          />
          <Bar
            dataKey="interest"
            name={t("debt.chart.interest")}
            stackId="split"
            fill={INTEREST}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
