"use client";

// What net worth is MADE of, and how the current month is running.
//
// The hero above gives one number. On its own that number is unactionable: it
// does not say whether the wealth sits in securities or in a current account,
// nor whether this month is going the right way. These two blocks answer both,
// and they are the reason the dashboard can now be free of a single ticker
// symbol (positions and watchlist moved to /portfolio).
//
// The month block deliberately counts CASH FLOW, not income vs expense: a loan
// instalment leaving the joint account is money gone from the pocket even
// though net worth is unchanged. `liquidCashEffect` draws that line, and
// "still due" adds what the recurring entries will post before the month ends,
// so the row answers "what is left of this month" rather than "what happened".

import { useMemo } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { portfolioTotals, summarizeAll } from "@/lib/finance/portfolio";
import { accountsTotals } from "@/lib/finance/accounts";
import { isLiquidAccount, liquidCashEffect, toBaseCurrency } from "@/lib/finance/spending";
import { pendingBookings } from "@/lib/finance/contract-bookings";
import { duePlannedBookings } from "@/lib/finance/planned";
import { today } from "@/lib/finance/dates";
import { formatCurrency } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export function WealthSplitCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const accountsEnabled = useFeatureFlag("accounts");
  const spendingEnabled = useFeatureFlag("spending");
  const movements = useAccountMovements();
  const base = data.profile.currency;
  const todayIso = today();

  const split = useMemo(() => {
    const invested = portfolioTotals(
      summarizeAll(data.assets, data.transactions, valuation),
    ).marketValue;
    if (!accountsEnabled) return { invested, liquid: 0, liabilities: 0 };
    const v = { base, fx: valuation.fx };
    const { liabilities } = accountsTotals(data.accounts, data.accountBalances, v, movements);
    // "Liquid" is the spendable pool, the same line the cash-flow maths draws:
    // an `other_asset` account (a car, a flat) is real wealth but not cash, so
    // it is folded in with the invested side rather than pretending to be
    // money you could spend tomorrow.
    let liquid = 0;
    let other = 0;
    for (const a of data.accounts) {
      if (a.isLiability) continue;
      const totals = accountsTotals([a], data.accountBalances, v, movements);
      if (isLiquidAccount(a)) liquid += totals.assets;
      else other += totals.assets;
    }
    return { invested: invested + other, liquid, liabilities };
  }, [
    data.assets,
    data.transactions,
    data.accounts,
    data.accountBalances,
    valuation,
    base,
    accountsEnabled,
    movements,
  ]);

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

  const net = split.invested + split.liquid - split.liabilities;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold">{t("dashboard.split.title")}</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label={t("dashboard.split.invested")}
            value={formatCurrency(split.invested, base)}
            isPrivate
          />
          <Stat
            label={t("dashboard.split.liquid")}
            value={formatCurrency(split.liquid, base)}
            isPrivate
          />
          <Stat
            label={t("dashboard.split.liabilities")}
            value={formatCurrency(-split.liabilities, base)}
            valueClassName={split.liabilities > 0 ? "text-red-600 dark:text-red-400" : ""}
            isPrivate
          />
        </div>
        <p className="mt-3 text-sm text-zinc-500">
          {t("dashboard.split.total", { total: formatCurrency(net, base) })}
        </p>
      </Card>

      {month && (
        <Card>
          <h2 className="text-lg font-semibold">{t("dashboard.month.title")}</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label={t("dashboard.month.in")}
              value={formatCurrency(month.inflow, base)}
              isPrivate
            />
            <Stat
              label={t("dashboard.month.out")}
              value={formatCurrency(-month.outflow, base)}
              valueClassName={month.outflow > 0 ? "text-red-600 dark:text-red-400" : ""}
              isPrivate
            />
            <Stat
              label={t("dashboard.month.open")}
              value={formatCurrency(-month.open, base)}
              valueClassName={month.open > 0 ? "text-amber-600 dark:text-amber-400" : ""}
              isPrivate
            />
          </div>
          <p className="mt-3 text-sm text-zinc-500">{t("dashboard.month.hint")}</p>
        </Card>
      )}
    </div>
  );
}
