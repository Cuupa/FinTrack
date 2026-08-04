"use client";

// Cash-flow forecast (flag `plannedCashflow`): the next six months as booked
// figures plus what is still expected from planned entries and registered
// contracts (`plannedForecast`, pure). Everything is converted to the base
// currency there, the same convention as the ledger totals and the Sankey card.
//
// No loading state: the data is already in memory via usePortfolio(), so there
// is nothing to wait for -- an empty forecast gets a sentence, not a skeleton.

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { today } from "@/lib/finance/dates";
import { plannedForecast, plannedMonthlyTotals } from "@/lib/finance/planned";
import { formatCurrency } from "@/lib/format";
import { axisCurrencyFormatter, yAxisWidth } from "@/components/charts/axis";
import { Card, Stat } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";
import { intlLocale } from "@/lib/i18n/locale";

const MONTHS = 6;
const EMERALD = "#10b981";
const EMERALD_SOFT = "#6ee7b7";
const ROSE = "#f43f5e";
const ROSE_SOFT = "#fda4af";
const ZINC = "#71717a";

/** "2026-01" → "Jan '26" in the active locale. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const mon = new Intl.DateTimeFormat(intlLocale(), { month: "short" }).format(new Date(y, m - 1, 1));
  return `${mon} '${String(y).slice(2)}`;
}

/** Self-gated like `BudgetsCard`/`PlannedCard`; see the note there. */
export function ForecastCard() {
  const { enabled, locked } = useFeature("plannedCashflow");
  if (!enabled) return null;
  if (locked)
    return (
      <ProTeaser feature="plannedCashflow">
        <ForecastCardInner />
      </ProTeaser>
    );
  return <ForecastCardInner />;
}

function ForecastCardInner() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;

  const months = useMemo(
    () =>
      plannedForecast({
        plans: data.plannedCashflows,
        contracts: data.contracts,
        transactions: data.spendingTransactions,
        accounts: data.accounts,
        base,
        fx: valuation.fx,
        today: today(),
        months: MONTHS,
      }),
    [
      data.plannedCashflows,
      data.contracts,
      data.spendingTransactions,
      data.accounts,
      base,
      valuation.fx,
    ],
  );

  const monthly = useMemo(
    () => plannedMonthlyTotals(data.plannedCashflows, data.accounts, base, valuation.fx),
    [data.plannedCashflows, data.accounts, base, valuation.fx],
  );

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        label: monthLabel(m.month),
        income: m.actualIncome,
        plannedIncome: m.plannedIncome,
        // Expenses go below the axis so income and expense read as opposite
        // directions instead of two bars of the same sign.
        expense: -m.actualExpense,
        plannedExpense: -m.plannedExpense,
        cumulative: m.projectedCumulative,
      })),
    [months],
  );

  const hasAnything = months.some(
    (m) =>
      m.actualIncome !== 0 ||
      m.actualExpense !== 0 ||
      m.plannedIncome !== 0 ||
      m.plannedExpense !== 0,
  );

  const tickValues = useMemo(
    () =>
      chartData.flatMap((d) => [
        d.income + d.plannedIncome,
        d.expense + d.plannedExpense,
        d.cumulative,
      ]),
    [chartData],
  );
  const tickFormatter = axisCurrencyFormatter(tickValues, base);
  const axisWidth = yAxisWidth(tickValues.map((v) => tickFormatter(v)));

  return (
    <Card data-tour="spending-forecast">
      <h2 className="text-lg font-semibold">{t("spending.forecast.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        {t("spending.forecast.intro", { n: String(MONTHS) })}
      </p>

      {!hasAnything ? (
        <p className="mt-3 text-sm text-zinc-500">{t("spending.forecast.empty")}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label={t("spending.forecast.monthlyIncome")}
              value={formatCurrency(monthly.income, base)}
              isPrivate
            />
            <Stat
              label={t("spending.forecast.monthlyExpense")}
              value={formatCurrency(monthly.expense, base)}
              isPrivate
            />
            <Stat
              label={t("spending.forecast.monthlyNet")}
              value={formatCurrency(monthly.net, base)}
              isPrivate
              valueClassName={monthly.net < 0 ? "text-red-600 dark:text-red-400" : ""}
            />
          </div>

          <div
            className="mt-4 h-72 w-full"
            role="img"
            aria-label={t("spending.forecast.aria", { n: String(MONTHS) })}
            data-private-axis
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-zinc-200 dark:stroke-zinc-800"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  minTickGap={8}
                  stroke="currentColor"
                  className="text-zinc-400"
                />
                <YAxis
                  tickFormatter={(v) => tickFormatter(Number(v))}
                  width={axisWidth}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-zinc-400"
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid rgba(120,120,120,0.3)",
                    fontSize: 13,
                  }}
                  formatter={(v, name) => [formatCurrency(Math.abs(Number(v)), base), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="income"
                  name={t("spending.forecast.income")}
                  stackId="in"
                  fill={EMERALD}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="plannedIncome"
                  name={t("spending.forecast.plannedIncome")}
                  stackId="in"
                  fill={EMERALD_SOFT}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="expense"
                  name={t("spending.forecast.expense")}
                  stackId="out"
                  fill={ROSE}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="plannedExpense"
                  name={t("spending.forecast.plannedExpense")}
                  stackId="out"
                  fill={ROSE_SOFT}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  name={t("spending.forecast.cumulative")}
                  stroke={ZINC}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}
