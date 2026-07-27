"use client";

// Cash-flow analysis, split off /spending (owner call): that page had grown to
// eight containers and had become unreadable. /spending now answers "what did
// I book and what recurs", this page answers "where does the money go and does
// it add up". Nothing was deleted in the split -- the same three cards, one
// page over.
//
// Gated on the same `spending` flag as its cards and its data: a separate flag
// would let the nav offer a page whose every card renders a teaser.

import { SpendingSankeyCard } from "@/components/spending/spending-sankey-card";
import { ForecastCard } from "@/components/spending/forecast-card";
import { BudgetsCard } from "@/components/spending/budgets-card";
import { SpendingSkeleton } from "@/components/spending/spending-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Card, PageHeader, Stat } from "@/components/ui/primitives";
import { incomeExpenseSplit, toBaseCurrency } from "@/lib/finance/spending";
import { formatCurrency } from "@/lib/format";
import { useMemo } from "react";

/** Income / expense / net over the whole ledger, base currency. Moved here
 *  with the rest of the analysis: it answers "does it add up", which is this
 *  page's question, not /spending's "what did I book". */
function Totals() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const totals = useMemo(
    () =>
      incomeExpenseSplit(
        toBaseCurrency(data.spendingTransactions, data.accounts, base, valuation.fx),
      ),
    [data.spendingTransactions, data.accounts, base, valuation.fx],
  );
  return (
    <Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label={t("spending.totals.income")}
          value={formatCurrency(totals.income, base)}
          isPrivate
        />
        <Stat
          label={t("spending.totals.expense")}
          value={formatCurrency(totals.expense, base)}
          isPrivate
        />
        <Stat
          label={t("spending.totals.net")}
          value={formatCurrency(totals.net, base)}
          valueClassName={totals.net < 0 ? "text-red-600 dark:text-red-400" : ""}
          isPrivate
        />
      </div>
    </Card>
  );
}

function CashflowView() {
  return (
    <div className="space-y-6">
      <Totals />
      <SpendingSankeyCard />
      <ForecastCard />
      <BudgetsCard />
    </div>
  );
}

export default function CashflowPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("spending");
  return (
    <div className="space-y-6">
      <PageHeader title={t("cashflow.title")} subtitle={t("cashflow.subtitle")} />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <SpendingSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="spending">
          <CashflowView />
        </ProTeaser>
      ) : (
        <CashflowView />
      )}
    </div>
  );
}
