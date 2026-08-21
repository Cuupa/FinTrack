"use client";

// Cash-flow overview card. Two views of the same period: `Geldfluss` (the
// default) draws the Sankey (income groups -> Total -> expense groups + a
// savings / shortfall link); `Balken` ranks income and expense category groups
// as horizontal bars. The flow leads because it shows the shape of the money
// at a glance; the bars stay available for a ranked "where does it go" read.
//
// All graph-building lives in lib/finance/spending.ts (spendingSankeyData +
// spendingGroupBreakdown) — this file only wires context, windowing and
// rendering. The Sankey itself is SankeyChart, shared with the read-only
// shared view.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { type Timeframe, timeframeStart, today } from "@/lib/finance/dates";
import {
  incomeExpenseSplit,
  spendingGroupBreakdown,
  spendingSankeyData,
  toBaseCurrency,
} from "@/lib/finance/spending";
import { formatCurrency } from "@/lib/format";
import { colorForLabel } from "@/lib/colors";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { inMonth } from "@/components/ui/month-picker";
import { useI18n } from "@/lib/i18n/i18n-context";
import { SankeyChart } from "./sankey-chart";
import { SankeyShareMenu } from "./sankey-share-menu";

const PERIODS: Timeframe[] = ["1M", "3M", "YTD", "1Y", "MAX"];
type FlowView = "bars" | "flow";

export function SpendingSankeyCard({ month = null }: { month?: string | null }) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const [timeframe, setTimeframe] = useState<Timeframe>("3M");
  const [view, setView] = useState<FlowView>("flow");

  const earliest = useMemo(
    () =>
      data.spendingTransactions.reduce<string | null>(
        (min, tx) => (min === null || tx.date < min ? tx.date : min),
        null,
      ),
    [data.spendingTransactions],
  );

  // A chosen month wins over the rolling window: the two answer the same
  // question and the page-level filter is the one the user just set.
  const windowed = useMemo(() => {
    if (month) return data.spendingTransactions.filter((tx) => inMonth(tx.date, month));
    const start = timeframeStart(timeframe, today(), earliest);
    return data.spendingTransactions.filter((tx) => tx.date >= start);
  }, [data.spendingTransactions, timeframe, earliest, month]);

  const converted = useMemo(
    () => toBaseCurrency(windowed, data.accounts, base, valuation.fx),
    [windowed, data.accounts, base, valuation.fx],
  );

  const labels = useMemo(
    () => ({
      total: t("spending.sankey.totalNode"),
      savings: t("spending.sankey.savingsNode"),
      shortfall: t("spending.sankey.shortfallNode"),
      uncategorizedIncome: t("spending.list.uncategorized"),
      uncategorizedExpense: t("spending.list.uncategorized"),
    }),
    [t],
  );

  const graph = useMemo(
    () => spendingSankeyData(converted, data.spendingCategories, labels),
    [converted, data.spendingCategories, labels],
  );

  const breakdown = useMemo(
    () => spendingGroupBreakdown(converted, data.spendingCategories, labels),
    [converted, data.spendingCategories, labels],
  );

  const split = useMemo(() => incomeExpenseSplit(converted), [converted]);

  const ariaLabel = t("spending.sankey.ariaLabel", {
    income: formatCurrency(split.income, base),
    expense: formatCurrency(split.expense, base),
    net: formatCurrency(split.net, base),
  });

  const empty = graph.nodes.length === 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("cashflow.flow.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { label: t("cashflow.view.bars"), value: "bars" },
              { label: t("cashflow.view.flow"), value: "flow" },
            ]}
          />
          {/* A window control means nothing inside a single month. */}
          {!month && (
            <SegmentedControl
              size="sm"
              value={timeframe}
              onChange={setTimeframe}
              options={PERIODS.map((tf) => ({ label: tf, value: tf }))}
            />
          )}
          <SankeyShareMenu
            graph={graph}
            labels={{ total: labels.total, savings: labels.savings, shortfall: labels.shortfall }}
            split={split}
            currency={base}
            period={month ?? timeframe}
            periodKind={month ? "month" : "timeframe"}
          />
        </div>
      </div>
      {empty ? (
        <p className="py-16 text-center text-sm text-tertiary">{t("common.noData")}</p>
      ) : view === "flow" ? (
        <SankeyChart
          graph={graph}
          labels={labels}
          formatValue={(v) => formatCurrency(v, base)}
          ariaLabel={ariaLabel}
        />
      ) : (
        <div
          className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2"
          role="img"
          aria-label={ariaLabel}
        >
          <BreakdownColumn
            title={t("spending.totals.income")}
            total={breakdown.incomeTotal}
            groups={breakdown.income}
            currency={base}
          />
          <BreakdownColumn
            title={t("spending.totals.expense")}
            total={breakdown.expenseTotal}
            groups={breakdown.expense}
            currency={base}
          />
        </div>
      )}
    </Card>
  );
}

function BreakdownColumn({
  title,
  total,
  groups,
  currency,
}: {
  title: string;
  total: number;
  groups: { label: string; value: number }[];
  currency: string;
}) {
  const { t } = useI18n();
  const max = groups.reduce((m, g) => Math.max(m, g.value), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-subtle pb-2">
        <h3 className="text-xs font-semibold tracking-wider text-tertiary uppercase">{title}</h3>
        <span className="text-sm font-semibold tabular-nums text-primary" data-private>
          {formatCurrency(total, currency)}
        </span>
      </div>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-tertiary">{t("common.noData")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {groups.map((g) => (
            <li key={g.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium text-secondary">{g.label}</span>
                <span className="tabular-nums text-primary" data-private>
                  {formatCurrency(g.value, currency)}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${max > 0 ? Math.max(2, (g.value / max) * 100) : 0}%`,
                    backgroundColor: colorForLabel(g.label),
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
