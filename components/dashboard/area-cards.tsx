"use client";

// The non-investment areas, given real estate on the home screen.
//
// The dashboard was the portfolio tracker's own page: net-worth hero, holdings
// table, savings plans, watchlist. Accounts, spending and goals existed only as
// sidebar entries, which is why the product still read as "a portfolio tool
// trying to do more" — the home screen never showed them.
//
// Each card is self-gated on its feature flag and renders even when empty, with
// the action that fills it. An empty Accounts card that says "add one" is the
// point: it is how someone discovers the area exists. That is deliberately
// different from the investment cards below it, which hide when empty.

import Link from "next/link";
import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { useI18n } from "@/lib/i18n/i18n-context";
import { formatCurrency } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui/primitives";
import { accountsTotals, currentAccountBalance } from "@/lib/finance/accounts";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { incomeExpenseSplit, toBaseCurrency } from "@/lib/finance/spending";
import {
  goalInvestments,
  goalProgressPct,
  goalTotals,
  liabilityPayoffGoals,
  subGoals,
  topLevelGoals,
} from "@/lib/finance/goals";
import { today } from "@/lib/finance/dates";

/** Card head: the area's name links to its surface, the figure sits right. */
function AreaHead({
  href,
  label,
  value,
  valueClassName = "",
}: {
  href: string;
  label: string;
  value?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <Link
        href={href}
        className="text-sm font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 dark:hover:text-zinc-200 dark:focus-visible:outline-emerald-400"
      >
        {label}
      </Link>
      {value && (
        <span className={`text-xl font-semibold tabular-nums ${valueClassName}`} data-private="">
          {value}
        </span>
      )}
    </div>
  );
}

function AccountsCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const currency = data.profile.currency;
  const { t } = useI18n();

  const movements = useAccountMovements();

  const totals = useMemo(
    () =>
      accountsTotals(
        data.accounts,
        data.accountBalances,
        { base: currency, fx: valuation.fx },
        movements,
      ),
    [data.accounts, data.accountBalances, currency, valuation.fx, movements],
  );

  // Largest first, but only among the accounts that hold money: sorting every
  // account by absolute balance let one mortgage outrank every current account
  // there is, so the card listed three debts and nothing else. Liabilities get
  // their own summed line below instead. With no credit account at all they are
  // the only thing to list, so they take the list over.
  const rows = useMemo(() => {
    const withBalance = data.accounts.map((a) => ({
      account: a,
      balance: currentAccountBalance(a, data.accountBalances, movements),
    }));
    const assets = withBalance.filter((r) => !r.account.isLiability);
    const source = assets.length > 0 ? assets : withBalance;
    return [...source].sort((x, y) => y.balance - x.balance);
  }, [data.accounts, data.accountBalances, movements]);

  const hasAssetAccount = data.accounts.some((a) => !a.isLiability);
  // The headline answers "how much money do I have"; net worth is the hero's
  // job, one card up, and repeating it here only ever showed the mortgage.
  const headline = hasAssetAccount ? totals.assets : -totals.liabilities;

  return (
    <Card data-tour="area-accounts">
      <AreaHead
        href="/accounts"
        label={t("nav.accounts")}
        value={data.accounts.length > 0 ? formatCurrency(headline, currency) : undefined}
        valueClassName={headline < 0 ? "text-red-600 dark:text-red-400" : ""}
      />
      {data.accounts.length === 0 ? (
        <EmptyState
          className="py-6"
          title={t("dash.area.noAccounts")}
          action={
            <Link
              href="/accounts"
              className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
            >
              {t("dash.area.addAccount")}
            </Link>
          }
        />
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map(({ account, balance }) => (
            <li key={account.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-zinc-600 dark:text-zinc-300">{account.name}</span>
              <span
                className={`shrink-0 tabular-nums ${
                  account.isLiability ? "text-red-600 dark:text-red-400" : ""
                }`}
                data-private=""
              >
                {formatCurrency(
                  account.isLiability ? -balance : balance,
                  account.currency || currency,
                )}
              </span>
            </li>
          ))}
          {hasAssetAccount && totals.liabilities !== 0 && (
            <li className="flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-1.5 text-sm dark:border-zinc-800">
              <span className="text-zinc-500">{t("dash.area.liabilities")}</span>
              <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400" data-private="">
                {formatCurrency(-totals.liabilities, currency)}
              </span>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function SpendingCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const currency = data.profile.currency;
  const { t } = useI18n();

  const month = today().slice(0, 7);
  const split = useMemo(() => {
    const inMonth = data.spendingTransactions.filter((tx) => tx.date.startsWith(month));
    if (inMonth.length === 0) return null;
    return incomeExpenseSplit(toBaseCurrency(inMonth, data.accounts, currency, valuation.fx));
  }, [data.spendingTransactions, data.accounts, currency, valuation.fx, month]);

  return (
    <Card>
      <AreaHead
        href="/spending"
        label={t("nav.spending")}
        value={split ? formatCurrency(split.expense, currency) : undefined}
      />
      {!split ? (
        <EmptyState
          className="py-6"
          title={t("dash.area.noSpending")}
          action={
            <Link
              href="/spending"
              className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
            >
              {t("dash.area.addSpending")}
            </Link>
          }
        />
      ) : (
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">{t("dash.area.thisMonthExpense")}</dt>
            <dd className="tabular-nums" data-private="">
              {formatCurrency(split.expense, currency)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500">{t("dash.area.thisMonthIncome")}</dt>
            <dd className="tabular-nums" data-private="">
              {formatCurrency(split.income, currency)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
            <dt className="text-zinc-500">{t("dash.area.thisMonthNet")}</dt>
            <dd
              className={`tabular-nums ${split.net < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-private=""
            >
              {formatCurrency(split.net, currency)}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

function GoalsCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const currency = data.profile.currency;
  const { t } = useI18n();

  // A goal can track the depot's value; that needs the holdings, not just
  // the accounts (lib/finance/goals.ts).
  const investments = useMemo(
    () => goalInvestments(data.assets, data.transactions, data.portfolios, valuation),
    [data.assets, data.transactions, data.portfolios, valuation],
  );

  // Liabilities carry their own derived payoff goals (lib/finance/goals.ts),
  // so the card counts what /goals lists, not just the typed-in ones. Only
  // top-level goals count: a sub-goal is part of one of them, not a goal of
  // its own (it would otherwise show up twice, once alone and once inside its
  // parent's summed total).
  const movements = useAccountMovements();

  const goals = useMemo(() => {
    const v = { base: currency, fx: valuation.fx };
    return [
      ...liabilityPayoffGoals(
        data.accounts,
        data.accountBalances,
        data.goals,
        today(),
        v,
        movements,
      ),
      ...topLevelGoals(data.goals),
    ];
  }, [data.goals, data.accounts, data.accountBalances, currency, valuation.fx, movements]);

  // Target and progress per goal, summed over its sub-goals where it has any.
  const totals = useMemo(() => {
    const v = { base: currency, fx: valuation.fx };
    return goals.map((goal) => ({
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
  }, [
    goals,
    data.goals,
    data.accounts,
    data.accountBalances,
    currency,
    valuation.fx,
    investments,
    movements,
  ]);

  const rows = useMemo(
    () =>
      totals
        .map(({ goal, target, current }) => ({ goal, pct: goalProgressPct(target, current) }))
        // Closest to done first: the ones worth a glance.
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3),
    [totals],
  );

  const reached = useMemo(
    () => totals.filter(({ target, current }) => target > 0 && current >= target).length,
    [totals],
  );

  return (
    <Card>
      <AreaHead
        href="/goals"
        label={t("nav.goals")}
        value={goals.length > 0 ? t("dash.goalsReached", { n: reached, m: goals.length }) : undefined}
      />
      {goals.length === 0 ? (
        <EmptyState
          className="py-6"
          title={t("dash.area.noGoals")}
          action={
            <Link
              href="/goals"
              className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
            >
              {t("dash.area.addGoal")}
            </Link>
          }
        />
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map(({ goal, pct }) => (
            <li key={goal.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-zinc-600 dark:text-zinc-300">{goal.name}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">{Math.round(pct)} %</span>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          ))}
          {/* The head counts every goal, the list shows the three closest to
              done -- so the ones left out say so instead of just missing. */}
          {goals.length > rows.length && (
            <li>
              <Link
                href="/goals"
                className="text-sm text-zinc-500 underline-offset-2 hover:underline"
              >
                {t("dash.goalsMore", { n: goals.length - rows.length })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/**
 * Renders whichever of the three areas are enabled. Nothing at all when every
 * flag is off, so a pure investment install keeps its old dashboard.
 */
export function AreaCards() {
  const accounts = useFeature("accounts");
  const spending = useFeature("spending");
  const goals = useFeature("goals");

  const areas = [
    { state: accounts, flag: "accounts" as const, card: <AccountsCard /> },
    { state: spending, flag: "spending" as const, card: <SpendingCard /> },
    { state: goals, flag: "goals" as const, card: <GoalsCard /> },
  ].filter((a) => a.state.enabled);

  const count = areas.length;
  if (count === 0) return null;

  return (
    <div
      className={`grid grid-cols-1 gap-4 ${
        count === 3 ? "lg:grid-cols-3" : count === 2 ? "sm:grid-cols-2" : ""
      }`}
    >
      {/* A Pro-locked area keeps its slot in the grid, blurred behind the
          paywall message, rather than vanishing from the home screen. */}
      {areas.map((a) =>
        a.state.locked ? (
          <ProTeaser key={a.flag} feature={a.flag}>
            {a.card}
          </ProTeaser>
        ) : (
          <div key={a.flag}>{a.card}</div>
        ),
      )}
    </div>
  );
}
