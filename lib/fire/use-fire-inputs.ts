"use client";

// The figures a FIRE plan rests on, derived once for everyone who needs them.
//
// The FIRE tab and the simulator's "Ruhestand" mode ask the same question from
// two directions -- what is the target, and what do the markets do to it -- so
// they must start from the SAME net worth, the same trailing expenses, the same
// measured return and the same pension bridge. Two copies would drift, and a
// simulation seeded from figures the FIRE tiles do not show is worse than no
// simulation at all.
//
// Histories are passed in rather than fetched here: both callers already run
// `useHistory` for their own charts, and a second fetch of the same series
// would be a network round trip for numbers the caller is already holding.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { usePensionReference } from "@/lib/pension/use-pension-reference";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { accountsValueOn } from "@/lib/finance/accounts";
import { portfolioTotals, summarizeAll } from "@/lib/finance/portfolio";
import { portfolioOrBenchmarkStats } from "@/lib/finance/stats";
import { monthlyContributionOf } from "@/lib/finance/savings-plans";
import { projectPension } from "@/lib/finance/pension";
import { trailingAnnualExpenses, type PensionBridge } from "@/lib/finance/fire";
import { today } from "@/lib/finance/dates";
import type { Asset } from "@/lib/types";
import type { HistoryMap } from "@/lib/history/history";

/**
 * Historical lookback for the return estimate. FIRE planning is a decade-plus
 * horizon, so this leans further on `stats.ts`'s regression toward the long-run
 * capital-market assumption than the general simulator's default (which couples
 * the lookback to the user-chosen accumulation horizon).
 */
export const RETURN_HORIZON_YEARS = 20;

export interface FireInputs {
  /** Holdings plus the signed sum of every balance account, same as the hero. */
  netWorth: number;
  /** Trailing-12-month expenses, annualised. */
  annualExpenses: number;
  /** False when there is no spending history to measure expenses from. */
  hasExpenseData: boolean;
  /** Monthly contribution derived from the active savings plans. */
  monthlyContribution: number;
  /** Measured expected return, as a fraction. */
  expectedReturn: number;
  /** Measured volatility, as a fraction. */
  volatility: number;
  /** Held positions with their market value. */
  holdings: { asset: Asset; marketValue: number }[];
  /** Whether the pension feature is on at all. */
  pensionEnabled: boolean;
  /** The guaranteed income the plan may lean on, or undefined when unknown. */
  pensionBridge: PensionBridge | undefined;
  /** Projected monthly pension (statutory + private, or private alone when the
   *  statutory half cannot be valued). */
  pensionMonthly: number;
  /** Calendar year the pension starts, or null without a birth year. */
  retirementYear: number | null;
}

export function useFireInputs(histories: HistoryMap): FireInputs {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const movements = useAccountMovements();
  const pensionReference = usePensionReference();
  const pensionEnabled = useFeatureFlag("pension");
  const todayIso = today();

  const holdings = useMemo(
    () =>
      summarizeAll(data.assets, data.transactions, valuation)
        .filter((h) => h.position.shares > 0)
        .map((h) => ({ asset: h.asset, marketValue: h.marketValue })),
    [data.assets, data.transactions, valuation],
  );

  // Same net-worth figure as the dashboard hero / /health: holdings market
  // value plus the signed sum of every balance account.
  const netWorth = useMemo(() => {
    const totals = portfolioTotals(summarizeAll(data.assets, data.transactions, valuation));
    const accountsNet = accountsValueOn(
      data.accounts,
      data.accountBalances,
      todayIso,
      valuation,
      movements,
    );
    return totals.marketValue + accountsNet;
  }, [
    data.assets,
    data.transactions,
    data.accounts,
    data.accountBalances,
    valuation,
    todayIso,
    movements,
  ]);

  const annualExpenses = useMemo(
    () => trailingAnnualExpenses(data.spendingTransactions, todayIso),
    [data.spendingTransactions, todayIso],
  );

  const monthlyContribution = useMemo(
    () => monthlyContributionOf(data.savingsPlans, data.assets, valuation),
    [data.savingsPlans, data.assets, valuation],
  );

  const stats = useMemo(
    () => portfolioOrBenchmarkStats(holdings, RETURN_HORIZON_YEARS, histories),
    [holdings, histories],
  );

  // The pension is not a neighbouring feature, it is an input to this one:
  // guaranteed income from a fixed year is capital never to be accumulated.
  const projection = useMemo(
    () =>
      projectPension({
        entries: data.pensionPoints,
        statements: data.pensionStatements,
        contracts: data.pensionContracts,
        contractValues: data.pensionContractValues,
        reference: pensionReference,
        settings: data.profile.pensionSettings,
        currentYear: Number(todayIso.slice(0, 4)),
      }),
    [
      data.pensionPoints,
      data.pensionStatements,
      data.pensionContracts,
      data.pensionContractValues,
      data.profile.pensionSettings,
      pensionReference,
      todayIso,
    ],
  );

  // Without a Rentenwert the statutory half cannot be valued, so only the
  // private policies count -- the same "report what is known, invent nothing"
  // rule the Pension tab follows.
  const pensionMonthly = projection.monthlyTotal ?? projection.monthlyPrivate;
  const pensionBridge: PensionBridge | undefined =
    pensionEnabled && projection.retirementYear != null && pensionMonthly > 0
      ? {
          annualIncome: pensionMonthly * 12,
          yearsUntilStart: Math.max(0, projection.retirementYear - Number(todayIso.slice(0, 4))),
        }
      : undefined;

  return {
    netWorth,
    annualExpenses,
    hasExpenseData: annualExpenses > 0,
    monthlyContribution,
    expectedReturn: stats.expectedReturn,
    volatility: stats.volatility,
    holdings,
    pensionEnabled,
    pensionBridge,
    pensionMonthly,
    retirementYear: projection.retirementYear,
  };
}
