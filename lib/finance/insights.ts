// The overview's "Wichtige Hinweise" (spec §9 I): at most three prioritized,
// clickable findings drawn ONLY from data the user already has. No generic
// motivational cards -- every insight is a fact about the user's own figures
// (reserve depth, savings rate, leverage, goals reached), ranked so the most
// pressing one leads, each pointing at the page where it can be acted on.
//
// Pure and React/i18n-free: this returns stable ids + numeric params, and the
// component maps each id to its localized message. The finance core never
// imports the dictionary.

/** The reserve everyone should hold before investing, in months of expenses.
 *  Three months is the widely-cited minimum; it is a UI convention, not market
 *  reference data, so it lives here rather than in the DB seed. Shared with the
 *  Planfortschritt card so the two never disagree on the target. */
export const RESERVE_TARGET_MONTHS = 3;

/** Debt above this multiple of annual income reads as high leverage. Total
 *  debt / a year of income (see `debtToIncomeRatio`), so a mortgage sits high
 *  by nature; 3x is where it is worth a second look, not a warning by default. */
const HIGH_LEVERAGE_MULTIPLE = 3;

export type InsightSeverity = "positive" | "warning" | "negative";

export type InsightId = "negativeSavings" | "reserveLow" | "highDebt" | "goalsReached";

export interface Insight {
  id: InsightId;
  severity: InsightSeverity;
  /** Higher wins the limited slots. */
  rank: number;
  /** Numeric inputs for the localized copy (formatted by the component). */
  params: Record<string, number>;
  /** Where the insight is acted on. */
  href: string;
}

export interface InsightInput {
  /** Liquid reserve depth, from `computeFinancialHealth`. Null = no expense
   *  history to measure against, so no reserve insight. */
  monthsOfExpensesCovered: number | null;
  /** (income - expense) / income. Null = no income to measure against. */
  savingsRate: number | null;
  /** Total debt / annual income. Null = no income to measure against. */
  debtToIncomeRatio: number | null;
  /** How many tracked goals have reached their target. */
  goalsReached: number;
}

/**
 * The ranked insights for the overview, most pressing first, capped at `max`
 * (default 3, the spec limit). Every branch is a plain fact about the inputs:
 * an empty result means the user's figures raised nothing worth surfacing, not
 * that a card was suppressed.
 */
export function keyInsights(input: InsightInput, max = 3): Insight[] {
  const out: Insight[] = [];

  // Spending outran income over the trailing window: the most urgent thing the
  // overview can say, because it compounds every month it holds.
  if (input.savingsRate != null && input.savingsRate < 0) {
    out.push({
      id: "negativeSavings",
      severity: "negative",
      rank: 100,
      params: { rate: input.savingsRate },
      href: "/spending",
    });
  }

  // Reserve below the three-month floor: the shortfall in months, so the copy
  // states the gap rather than a verdict.
  if (
    input.monthsOfExpensesCovered != null &&
    input.monthsOfExpensesCovered < RESERVE_TARGET_MONTHS
  ) {
    out.push({
      id: "reserveLow",
      severity: "warning",
      rank: 80,
      params: { months: input.monthsOfExpensesCovered, target: RESERVE_TARGET_MONTHS },
      href: "/accounts",
    });
  }

  // Debt well above a year of income: stated as the multiple, left for the user
  // to weigh -- a mortgage is not a problem, an outlier ratio is worth a glance.
  if (input.debtToIncomeRatio != null && input.debtToIncomeRatio > HIGH_LEVERAGE_MULTIPLE) {
    out.push({
      id: "highDebt",
      severity: "warning",
      rank: 60,
      params: { multiple: input.debtToIncomeRatio },
      href: "/debt",
    });
  }

  // The one positive note, so a healthy plan is not all silence. Ranks below
  // the concerns: good news can wait behind a shortfall.
  if (input.goalsReached > 0) {
    out.push({
      id: "goalsReached",
      severity: "positive",
      rank: 20,
      params: { count: input.goalsReached },
      href: "/goals",
    });
  }

  return out.sort((a, b) => b.rank - a.rank).slice(0, max);
}
