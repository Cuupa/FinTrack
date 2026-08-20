"use client";

// Financial health, folded into the overview as a compact, clickable section
// (spec §9): the four gauges no longer earn a top-level nav page of their own,
// and the savings rate lives HERE rather than being repeated across KPI rows.
// The full read-only view stays at /health for anyone who follows the link.
//
// Reuses the exact `computeFinancialHealth` snapshot the /health page renders
// (same net-worth figure as the hero), so the two can never disagree.

import Link from "next/link";
import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { today } from "@/lib/finance/dates";
import { accountsValueOn } from "@/lib/finance/accounts";
import { portfolioTotals, summarizeAll } from "@/lib/finance/portfolio";
import { computeFinancialHealth } from "@/lib/finance/health";
import { formatNumber, formatPercent } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

/** One compact gauge: label above, value below. Optional private blur and a
 *  semantic colour on the value only (the label stays neutral). */
function Gauge({
  label,
  value,
  valueClassName = "",
  isPrivate = false,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  isPrivate?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-tertiary">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClassName}`}
        {...(isPrivate ? { "data-private": "" } : {})}
      >
        {value}
      </div>
    </div>
  );
}

function HealthSummaryInner() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const todayIso = today();

  const netWorth = useMemo(() => {
    const totals = portfolioTotals(summarizeAll(data.assets, data.transactions, valuation));
    const accountsNet = accountsValueOn(data.accounts, data.accountBalances, todayIso, valuation);
    return totals.marketValue + accountsNet;
  }, [data.assets, data.transactions, data.accounts, data.accountBalances, valuation, todayIso]);

  const snapshot = useMemo(
    () =>
      computeFinancialHealth(
        data.accounts,
        data.accountBalances,
        data.spendingTransactions,
        netWorth,
        todayIso,
        valuation,
      ),
    [data.accounts, data.accountBalances, data.spendingTransactions, netWorth, todayIso, valuation],
  );

  const noData = t("health.noData");
  const months = snapshot.monthsOfExpensesCovered;
  const savings = snapshot.savingsRate;
  const debt = snapshot.debtToIncomeRatio;
  const netWorthMultiple = snapshot.netWorthToIncome;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <Link
          href="/health"
          className="text-sm font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 dark:hover:text-zinc-200 dark:focus-visible:outline-emerald-400"
        >
          {t("health.title")}
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        <Gauge
          label={t("health.gauge.monthsOfExpenses.label")}
          value={months !== null ? `${formatNumber(months, 1)} ${t("health.unit.months")}` : noData}
          isPrivate
        />
        <Gauge
          label={t("health.gauge.savingsRate.label")}
          value={savings !== null ? formatPercent(savings) : noData}
          valueClassName={savings !== null && savings < 0 ? "text-negative" : ""}
        />
        <Gauge
          label={t("health.gauge.debtToIncome.label")}
          value={debt !== null ? formatPercent(debt) : noData}
          valueClassName={debt !== null && debt > 0 ? "text-warning" : ""}
        />
        <Gauge
          label={t("health.gauge.netWorthToIncome.label")}
          value={netWorthMultiple !== null ? `${formatNumber(netWorthMultiple, 1)}x` : noData}
          valueClassName={netWorthMultiple !== null && netWorthMultiple < 0 ? "text-negative" : ""}
          isPrivate
        />
      </div>
    </Card>
  );
}

/**
 * Renders the compact health section when the `finHealth` flag is on, blurred
 * behind a Pro teaser when the plan locks it, and nothing at all when the flag
 * is off -- same visibility rules the /health route follows.
 */
export function HealthSummaryCard() {
  const { enabled, locked } = useFeature("finHealth");
  if (!enabled) return null;
  if (locked) {
    return (
      <ProTeaser feature="finHealth">
        <HealthSummaryInner />
      </ProTeaser>
    );
  }
  return <HealthSummaryInner />;
}
