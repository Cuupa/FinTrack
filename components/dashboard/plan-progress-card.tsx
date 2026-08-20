"use client";

// "Aktueller Monat" pair, right half (spec §9 M2): progress against the three
// plans the overview tracks -- the reserve, named goals, and paying debt down.
// It is the Fortschritt in "Bestand, Bewegung und Fortschritt": the KPIs state
// stock, the Cashflow card states the month's movement, this states how far
// along the plans are. Each row self-gates on its feature flag and drops out
// when there is nothing to show, so the card renders only what the user tracks;
// nothing here duplicates the health section, which states ratios, not progress.

import Link from "next/link";
import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { today } from "@/lib/finance/dates";
import { computeFinancialHealth } from "@/lib/finance/health";
import { accountsValueOn } from "@/lib/finance/accounts";
import { portfolioTotals, summarizeAll } from "@/lib/finance/portfolio";
import {
  goalInvestments,
  goalProgressPct,
  goalTotals,
  liabilityPayoffGoals,
  subGoals,
  topLevelGoals,
} from "@/lib/finance/goals";
import { RESERVE_TARGET_MONTHS } from "@/lib/finance/insights";
import { formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

/** One labelled progress bar: label + right-aligned figure above a track. The
 *  figure carries no semantic colour -- progress is neutral, it is the number
 *  that speaks. `tone` tints the fill for the one case (a shrinking reserve)
 *  where the bar itself is the warning. */
function ProgressRow({
  label,
  figure,
  pct,
  tone = "accent",
}: {
  label: string;
  figure: string;
  pct: number;
  tone?: "accent" | "warning";
}) {
  const fill =
    tone === "warning" ? "bg-amber-500 dark:bg-amber-400" : "bg-emerald-600 dark:bg-emerald-500";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate text-zinc-600 dark:text-zinc-300">{label}</span>
        <span className="shrink-0 tabular-nums text-zinc-500" data-private="">
          {figure}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="presentation"
      >
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

export function PlanProgressCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const currency = data.profile.currency;
  const todayIso = today();
  const movements = useAccountMovements();

  // Same flag precedent as MonthFlowCard: these dashboard aggregation rows hide
  // when their feature is off/locked (the dedicated route is the sellable
  // surface, this is a summary of it).
  const accountsEnabled = useFeatureFlag("accounts");
  const spendingEnabled = useFeatureFlag("spending");
  const goalsEnabled = useFeatureFlag("goals");
  const reserveEnabled = accountsEnabled && spendingEnabled;

  // Reserve: months of expenses the liquid balance covers, against the
  // three-month floor. Reuses the exact health snapshot the /health page and
  // the health section render, so the number is the same everywhere.
  const months = useMemo(() => {
    if (!reserveEnabled) return null;
    const totals = portfolioTotals(summarizeAll(data.assets, data.transactions, valuation));
    const netWorth =
      totals.marketValue +
      accountsValueOn(data.accounts, data.accountBalances, todayIso, valuation, movements);
    return computeFinancialHealth(
      data.accounts,
      data.accountBalances,
      data.spendingTransactions,
      netWorth,
      todayIso,
      valuation,
    ).monthsOfExpensesCovered;
  }, [
    reserveEnabled,
    data.assets,
    data.transactions,
    data.accounts,
    data.accountBalances,
    data.spendingTransactions,
    valuation,
    todayIso,
    movements,
  ]);

  // Goals: same computation as the retired GoalsCard -- derived liability
  // payoff goals plus the user's top-level goals, summed over sub-goals, three
  // closest to done, with an "Alle Ziele" link when more exist (spec §9).
  const investments = useMemo(
    () => goalInvestments(data.assets, data.transactions, data.portfolios, valuation),
    [data.assets, data.transactions, data.portfolios, valuation],
  );
  const goalRows = useMemo(() => {
    if (!goalsEnabled) return null;
    const v = { base: currency, fx: valuation.fx };
    const goals = [
      ...liabilityPayoffGoals(data.accounts, data.accountBalances, data.goals, todayIso, v, movements),
      ...topLevelGoals(data.goals),
    ];
    const totals = goals.map((goal) => ({
      goal,
      ...goalTotals(
        goal,
        subGoals(data.goals, goal.id),
        data.accounts,
        data.accountBalances,
        v,
        investments,
        movements,
      ),
    }));
    const reached = totals.filter(({ target, current }) => target > 0 && current >= target).length;
    const rows = totals
      .map(({ goal, target, current }) => ({ goal, pct: goalProgressPct(target, current) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3);
    return { rows, total: goals.length, reached };
  }, [
    goalsEnabled,
    data.goals,
    data.accounts,
    data.accountBalances,
    currency,
    valuation.fx,
    investments,
    movements,
    todayIso,
  ]);

  // Debt: how much of the highest balance ever owed has been repaid, summed
  // across every liability. Derived payoff goals carry target = peak and
  // current = repaid (lib/finance/goals.ts), so the ratio is total-repaid over
  // total-peak -- the same yardstick a single payoff goal uses.
  const debt = useMemo(() => {
    if (!accountsEnabled) return null;
    const v = { base: currency, fx: valuation.fx };
    const payoff = liabilityPayoffGoals(
      data.accounts,
      data.accountBalances,
      data.goals,
      todayIso,
      v,
      movements,
    );
    if (payoff.length === 0) return null;
    let peak = 0;
    let repaid = 0;
    for (const goal of payoff) {
      const { target, current } = goalTotals(goal, [], data.accounts, data.accountBalances, v, undefined, movements);
      peak += target;
      repaid += current;
    }
    if (!(peak > 0)) return null;
    return { pct: (repaid / peak) * 100 };
  }, [
    accountsEnabled,
    data.accounts,
    data.accountBalances,
    data.goals,
    currency,
    valuation.fx,
    movements,
    todayIso,
  ]);

  const hasReserve = months != null;
  const hasGoals = goalRows != null && goalRows.total > 0;
  const hasDebt = debt != null;
  if (!hasReserve && !hasGoals && !hasDebt) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-primary">{t("overview.plan.title")}</h2>
      <div className="mt-4 space-y-5">
        {hasReserve && (
          <ProgressRow
            label={t("overview.plan.reserve")}
            figure={`${formatNumber(months, 1)} / ${RESERVE_TARGET_MONTHS} ${t("health.unit.months")}`}
            pct={(months / RESERVE_TARGET_MONTHS) * 100}
            tone={months < RESERVE_TARGET_MONTHS ? "warning" : "accent"}
          />
        )}

        {hasGoals && (
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <Link
                href="/goals"
                className="text-xs font-medium uppercase tracking-wide text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 dark:hover:text-zinc-200 dark:focus-visible:outline-emerald-400"
              >
                {t("nav.goals")}
              </Link>
              <span className="text-xs tabular-nums text-zinc-500">
                {t("dash.goalsReached", { n: goalRows.reached, m: goalRows.total })}
              </span>
            </div>
            <div className="space-y-2.5">
              {goalRows.rows.map(({ goal, pct }) => (
                <ProgressRow
                  key={goal.id}
                  label={goal.name}
                  figure={`${Math.round(pct)} %`}
                  pct={pct}
                />
              ))}
              {goalRows.total > goalRows.rows.length && (
                <Link
                  href="/goals"
                  className="inline-block text-sm text-zinc-500 underline-offset-2 hover:underline"
                >
                  {t("overview.plan.allGoals")}
                </Link>
              )}
            </div>
          </div>
        )}

        {hasDebt && (
          <ProgressRow
            label={t("overview.plan.debtPaid")}
            figure={`${Math.round(debt.pct)} %`}
            pct={debt.pct}
          />
        )}
      </div>
    </Card>
  );
}
