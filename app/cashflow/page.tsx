"use client";

// Cash-flow analysis, split off /spending (owner call): that page had grown to
// eight containers and had become unreadable. /spending now answers "what did
// I book and what recurs", this page answers "where does the money go and does
// it add up".
//
// The three questions no longer stack as one long scroll (spec §10/§11): they
// are tabs. Übersicht = the totals + the flow (bars, Sankey as an alternate
// view); Budgets = the caps; Prognose = the forward-looking forecast. Budgets
// and Prognose only carry a tab where their own feature is on, so the strip
// never offers a tab whose every card renders nothing.
//
// Gated on the same `spending` flag as its cards and its data: a separate flag
// would let the nav offer a page whose every card renders a teaser.

import { useMemo, useState } from "react";

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
import { Card, PageHeader, PAGE_STACK, Stat } from "@/components/ui/primitives";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { MonthPicker, inMonth } from "@/components/ui/month-picker";
import { incomeExpenseSplit, toBaseCurrency } from "@/lib/finance/spending";
import { formatCurrency } from "@/lib/format";

type CashflowTab = "overview" | "budgets" | "forecast";

/** Income / expense / net over the ledger, base currency. Answers "does it add
 *  up", which is this page's question. Net carries semantic color because it
 *  is a FLOW, not a stock (spec §6.2): a negative month genuinely means
 *  expenses beat income. */
function Totals({ month }: { month: string | null }) {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const totals = useMemo(
    () =>
      incomeExpenseSplit(
        toBaseCurrency(
          data.spendingTransactions.filter((tx) => inMonth(tx.date, month)),
          data.accounts,
          base,
          valuation.fx,
        ),
      ),
    [data.spendingTransactions, data.accounts, base, valuation.fx, month],
  );
  return (
    <Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={t("spending.totals.income")} value={formatCurrency(totals.income, base)} isPrivate />
        <Stat label={t("spending.totals.expense")} value={formatCurrency(totals.expense, base)} isPrivate />
        <Stat
          label={t("spending.totals.net")}
          value={formatCurrency(totals.net, base)}
          valueClassName={totals.net < 0 ? "text-negative" : ""}
          isPrivate
        />
      </div>
    </Card>
  );
}

export default function CashflowPage() {
  const { t } = useI18n();
  const { loading, loadError, reload } = usePortfolio();
  const { enabled, locked } = useFeature("spending");
  // Paywalled features stay visible: a tab shows whenever its feature is on,
  // even when the plan locks it (the card renders its own ProTeaser).
  const budgets = useFeature("budgets");
  const forecast = useFeature("plannedCashflow");
  const [month, setMonth] = useState<string | null>(null);
  const [tab, setTab] = useState<CashflowTab>("overview");

  const tabItems: TabItem<CashflowTab>[] = [
    { value: "overview", label: t("cashflow.tab.overview") },
    ...(budgets.enabled ? ([{ value: "budgets", label: t("cashflow.tab.budgets") }] as TabItem<CashflowTab>[]) : []),
    ...(forecast.enabled ? ([{ value: "forecast", label: t("cashflow.tab.forecast") }] as TabItem<CashflowTab>[]) : []),
  ];

  return (
    <div className={PAGE_STACK}>
      <PageHeader
        title={t("cashflow.title")}
        subtitle={t("cashflow.subtitle")}
        actions={
          enabled && !locked && tab !== "forecast" ? (
            <MonthPicker value={month} onChange={setMonth} />
          ) : undefined
        }
      />
      {!enabled ? (
        <FeatureUnavailable />
      ) : loading ? (
        <SpendingSkeleton />
      ) : loadError ? (
        <LoadError onRetry={reload} />
      ) : locked ? (
        <ProTeaser feature="spending">
          <Totals month={month} />
          <SpendingSankeyCard month={month} />
        </ProTeaser>
      ) : (
        <>
          <Tabs items={tabItems} value={tab} onChange={setTab} />
          {tab === "overview" && (
            <div className={PAGE_STACK}>
              <Totals month={month} />
              <SpendingSankeyCard month={month} />
            </div>
          )}
          {tab === "budgets" && budgets.enabled && <BudgetsCard month={month} />}
          {/* The forecast looks forward, so the month filter has no meaning for
              it and its tab hides the picker (owner rule). */}
          {tab === "forecast" && forecast.enabled && <ForecastCard />}
        </>
      )}
    </div>
  );
}
