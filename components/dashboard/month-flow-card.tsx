"use client";

// How the current month is running.
//
// It used to carry a second block splitting net worth into invested/liquid/
// liabilities -- the same statement the hero's Finanzstatus strip already
// makes above the chart. Two headings for one set of figures is noise, so the
// split is gone and the status strip is the single place net worth is broken
// down (owner rule, round 27).
//
// This block deliberately counts CASH FLOW, not income vs expense: a loan
// instalment leaving the joint account is money gone from the pocket even
// though net worth is unchanged. `liquidCashEffect` draws that line, and
// "still due" adds what the recurring entries will post before the month ends,
// so the row answers "what is left of this month" rather than "what happened".

import { useMemo } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { liquidCashEffect, toBaseCurrency } from "@/lib/finance/spending";
import { pendingBookings } from "@/lib/finance/contract-bookings";
import { duePlannedBookings } from "@/lib/finance/planned";
import { today } from "@/lib/finance/dates";
import { formatCurrency } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export function MonthFlowCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const spendingEnabled = useFeatureFlag("spending");
  const base = data.profile.currency;
  const todayIso = today();

  const month = useMemo(() => {
    if (!spendingEnabled) return null;
    const prefix = todayIso.slice(0, 7);
    const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
    let inflow = 0;
    let outflow = 0;
    for (const tx of toBaseCurrency(
      data.spendingTransactions.filter((t2) => t2.date.slice(0, 7) === prefix),
      data.accounts,
      base,
      valuation.fx,
    )) {
      const effect = liquidCashEffect(tx, accountsById);
      if (effect > 0) inflow += effect;
      else outflow += -effect;
    }
    // Recurring entries already due but not yet reviewed: money the ledger does
    // not know about yet, which is exactly what makes the month look better
    // than it is if left out.
    let open = 0;
    for (const b of pendingBookings(data.contracts, todayIso)) {
      if (b.date.slice(0, 7) === prefix) open += Math.abs(b.amount);
    }
    for (const b of duePlannedBookings(data.plannedCashflows, todayIso)) {
      if (b.date.slice(0, 7) === prefix && b.amount < 0) open += -b.amount;
    }
    return { inflow, outflow, open };
  }, [
    data.spendingTransactions,
    data.accounts,
    data.contracts,
    data.plannedCashflows,
    base,
    valuation.fx,
    todayIso,
    spendingEnabled,
  ]);

  if (!month) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-primary">{t("dashboard.month.title")}</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={t("dashboard.month.in")} value={formatCurrency(month.inflow, base)} isPrivate />
        <Stat
          label={t("dashboard.month.out")}
          value={formatCurrency(-month.outflow, base)}
          valueClassName={month.outflow > 0 ? "text-negative" : ""}
          isPrivate
        />
        <Stat
          label={t("dashboard.month.open")}
          value={formatCurrency(-month.open, base)}
          valueClassName={month.open > 0 ? "text-warning" : ""}
          isPrivate
        />
      </div>
      <p className="mt-3 text-sm text-tertiary">{t("dashboard.month.hint")}</p>
    </Card>
  );
}
