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
import { incomeExpenseSplit, toBaseCurrency } from "@/lib/finance/spending";
import { goalProgress, goalProgressPct } from "@/lib/finance/goals";
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

  const totals = useMemo(
    () => accountsTotals(data.accounts, data.accountBalances, { base: currency, fx: valuation.fx }),
    [data.accounts, data.accountBalances, currency, valuation.fx],
  );

  // Largest first: on a summary card the big balances are what you check.
  const rows = useMemo(
    () =>
      [...data.accounts]
        .map((a) => ({ account: a, balance: currentAccountBalance(a, data.accountBalances) }))
        .sort((x, y) => Math.abs(y.balance) - Math.abs(x.balance))
        .slice(0, 3),
    [data.accounts, data.accountBalances],
  );

  return (
    <Card>
      <AreaHead
        href="/accounts"
        label={t("nav.accounts")}
        value={data.accounts.length > 0 ? formatCurrency(totals.net, currency) : undefined}
        valueClassName={totals.net < 0 ? "text-red-600 dark:text-red-400" : ""}
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

  const rows = useMemo(() => {
    const v = { base: currency, fx: valuation.fx };
    return data.goals
      .map((goal) => {
        const current = goalProgress(goal, data.accounts, data.accountBalances, v);
        return { goal, pct: goalProgressPct(goal.targetAmount, current) };
      })
      // Closest to done first: the ones worth a glance.
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3);
  }, [data.goals, data.accounts, data.accountBalances, currency, valuation.fx]);

  const reached = useMemo(() => {
    const v = { base: currency, fx: valuation.fx };
    return data.goals.filter(
      (g) =>
        g.targetAmount > 0 &&
        goalProgress(g, data.accounts, data.accountBalances, v) >= g.targetAmount,
    ).length;
  }, [data.goals, data.accounts, data.accountBalances, currency, valuation.fx]);

  return (
    <Card>
      <AreaHead
        href="/goals"
        label={t("nav.goals")}
        value={
          data.goals.length > 0
            ? t("dash.goalsReached", { n: reached, m: data.goals.length })
            : undefined
        }
      />
      {data.goals.length === 0 ? (
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
