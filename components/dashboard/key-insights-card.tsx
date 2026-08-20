"use client";

// "Wichtige Hinweise" (spec §9 I): at most three prioritized, clickable
// findings, each drawn only from the user's own figures -- never a generic
// motivational card. The ranking and the branches are pure (lib/finance/
// insights.ts); this component maps each insight id to its localized copy and
// renders it as a link to the page where it is acted on.
//
// It renders nothing when the figures raise nothing worth surfacing, so a
// healthy plan simply drops the section rather than padding it with filler.

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
  goalTotals,
  liabilityPayoffGoals,
  subGoals,
  topLevelGoals,
} from "@/lib/finance/goals";
import { keyInsights, type Insight } from "@/lib/finance/insights";
import { formatNumber, formatPercent } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

/** Localized copy for one insight, keyed by its stable id. Kept here so the
 *  finance core stays i18n-free and the dictionary owns the wording. */
function insightText(
  insight: Insight,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (insight.id) {
    case "negativeSavings":
      return t("overview.insight.negativeSavings", {
        rate: formatPercent(Math.abs(insight.params.rate)),
      });
    case "reserveLow":
      return t("overview.insight.reserveLow", {
        months: formatNumber(insight.params.months, 1),
        target: insight.params.target,
      });
    case "highDebt":
      return t("overview.insight.highDebt", {
        multiple: formatNumber(insight.params.multiple, 1),
      });
    case "goalsReached":
      return t("overview.insight.goalsReached", { n: insight.params.count });
  }
}

/** A small round marker keyed to severity -- a coloured dot, not a filled
 *  badge (badges are forbidden): emerald for good news, amber for a warning,
 *  red for a concern. */
function severityDot(severity: Insight["severity"]): string {
  if (severity === "positive") return "bg-emerald-500 dark:bg-emerald-400";
  if (severity === "negative") return "bg-red-500 dark:bg-red-400";
  return "bg-amber-500 dark:bg-amber-400";
}

export function KeyInsightsCard() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const currency = data.profile.currency;
  const todayIso = today();
  const movements = useAccountMovements();

  const accountsEnabled = useFeatureFlag("accounts");
  const spendingEnabled = useFeatureFlag("spending");
  const goalsEnabled = useFeatureFlag("goals");

  const insights = useMemo(() => {
    const v = { base: currency, fx: valuation.fx };

    // The same health snapshot the /health page and the health section render:
    // reserve depth, savings rate and leverage all come from it, so an insight
    // never contradicts the gauge it is drawn from. Off when the everyday-money
    // features that feed it are disabled.
    const healthUsable = accountsEnabled && spendingEnabled;
    const snapshot = healthUsable
      ? (() => {
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
          );
        })()
      : null;

    // Reached goals, counted the same way the goals card does (derived payoff
    // goals plus top-level goals, summed over sub-goals).
    let goalsReached = 0;
    if (goalsEnabled) {
      const investments = goalInvestments(
        data.assets,
        data.transactions,
        data.portfolios,
        valuation,
      );
      const goals = [
        ...liabilityPayoffGoals(data.accounts, data.accountBalances, data.goals, todayIso, v, movements),
        ...topLevelGoals(data.goals),
      ];
      goalsReached = goals.filter((goal) => {
        const { target, current } = goalTotals(
          goal,
          subGoals(data.goals, goal.id),
          data.accounts,
          data.accountBalances,
          v,
          investments,
          movements,
        );
        return target > 0 && current >= target;
      }).length;
    }

    return keyInsights({
      monthsOfExpensesCovered: snapshot?.monthsOfExpensesCovered ?? null,
      savingsRate: snapshot?.savingsRate ?? null,
      debtToIncomeRatio: snapshot?.debtToIncomeRatio ?? null,
      goalsReached,
    });
  }, [
    accountsEnabled,
    spendingEnabled,
    goalsEnabled,
    data.assets,
    data.transactions,
    data.accounts,
    data.accountBalances,
    data.spendingTransactions,
    data.goals,
    data.portfolios,
    currency,
    valuation,
    todayIso,
    movements,
  ]);

  if (insights.length === 0) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-primary">{t("overview.insights.title")}</h2>
      <ul className="mt-3 space-y-2">
        {insights.map((insight) => (
          <li key={insight.id}>
            <Link
              href={insight.href}
              className="group flex items-center gap-3 rounded-control border border-subtle px-3 py-2.5 text-sm transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:bg-zinc-800/40 dark:focus-visible:outline-emerald-400"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${severityDot(insight.severity)}`} />
              <span className="text-zinc-700 dark:text-zinc-200">{insightText(insight, t)}</span>
              <span
                className="ml-auto shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              >
                &rarr;
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
