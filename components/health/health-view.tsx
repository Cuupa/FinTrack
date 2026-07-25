"use client";

// Financial-health gauges (ROADMAP #7, flag `finHealth`): a read-only
// dashboard of four ratios derived from data that already exists elsewhere
// in the app (accounts, spending transactions, net worth) -- nothing is
// added, edited or deleted here, so there is no form and no table. Rides
// usePortfolio()/useLivePrices() like every other surface; no mode branching.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import { accountsValueOn } from "@/lib/finance/accounts";
import { portfolioTotals, summarizeAll } from "@/lib/finance/portfolio";
import { computeFinancialHealth } from "@/lib/finance/health";
import { formatNumber, formatPercent } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export function HealthView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const todayIso = today();

  // Same net-worth figure as the dashboard hero: holdings market value plus
  // the signed sum of every balance account (components/dashboard/net-worth-hero.tsx).
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
    <div className="space-y-6">
      <Card data-tour="health-gauges">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t("health.gauge.monthsOfExpenses.label")}
            value={
              months !== null
                ? `${formatNumber(months, 1)} ${t("health.unit.months")}`
                : noData
            }
            sub={months !== null ? t("health.gauge.monthsOfExpenses.hint") : undefined}
            isPrivate
          />
          <Stat
            label={t("health.gauge.savingsRate.label")}
            value={savings !== null ? formatPercent(savings) : noData}
            sub={savings !== null ? t("health.gauge.savingsRate.hint") : undefined}
            valueClassName={savings !== null && savings < 0 ? "text-red-600 dark:text-red-400" : ""}
          />
          <Stat
            label={t("health.gauge.debtToIncome.label")}
            value={debt !== null ? formatPercent(debt) : noData}
            sub={debt !== null ? t("health.gauge.debtToIncome.hint") : undefined}
            valueClassName={debt !== null && debt > 0 ? "text-amber-600 dark:text-amber-400" : ""}
          />
          <Stat
            label={t("health.gauge.netWorthToIncome.label")}
            value={netWorthMultiple !== null ? `${formatNumber(netWorthMultiple, 1)}x` : noData}
            sub={netWorthMultiple !== null ? t("health.gauge.netWorthToIncome.hint") : undefined}
            valueClassName={
              netWorthMultiple !== null && netWorthMultiple < 0 ? "text-red-600 dark:text-red-400" : ""
            }
            isPrivate
          />
        </div>
      </Card>
    </div>
  );
}
