"use client";

// Cash-flow Sankey (ROADMAP #2 follow-up): income category groups -> Total ->
// expense category groups, plus a Savings/"from savings" link carrying the
// period's net (see spendingSankeyData in lib/finance/spending.ts, which owns
// all the graph-building logic — this file only wires context + rendering).
// The chart itself lives in SankeyChart, shared with the read-only shared view.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { type Timeframe, timeframeStart, today } from "@/lib/finance/dates";
import { incomeExpenseSplit, spendingSankeyData, toBaseCurrency } from "@/lib/finance/spending";
import { formatCurrency } from "@/lib/format";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { inMonth } from "@/components/ui/month-picker";
import { useI18n } from "@/lib/i18n/i18n-context";
import { SankeyChart } from "./sankey-chart";
import { SankeyShareMenu } from "./sankey-share-menu";

const PERIODS: Timeframe[] = ["1M", "3M", "YTD", "1Y", "MAX"];

export function SpendingSankeyCard({ month = null }: { month?: string | null }) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const [timeframe, setTimeframe] = useState<Timeframe>("3M");

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

  const split = useMemo(() => incomeExpenseSplit(converted), [converted]);

  const ariaLabel = t("spending.sankey.ariaLabel", {
    income: formatCurrency(split.income, base),
    expense: formatCurrency(split.expense, base),
    net: formatCurrency(split.net, base),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("spending.sankey.title")}</h2>
        <div className="flex items-center gap-2">
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
      {graph.nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">{t("common.noData")}</p>
      ) : (
        <SankeyChart
          graph={graph}
          labels={labels}
          formatValue={(v) => formatCurrency(v, base)}
          ariaLabel={ariaLabel}
        />
      )}
    </Card>
  );
}
