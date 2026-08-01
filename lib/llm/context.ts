// Builds the compact JSON portfolio snapshot injected as the chat's system
// prompt preamble. PURE — no React, no lib/server import — so it's safe to
// unit test directly. Callers (components/llm/chat-bubble.tsx) assemble the
// input from data already in memory (usePortfolio, useLivePrices, the
// catalog, lib/finance/stats.ts, lib/finance/allocation.ts); this module only
// shapes, rounds, and JSON-encodes it.
//
// Invariants (see LLM_INTEGRATION.md "Portfolio context"):
//  - Never include internal ids (asset id, portfolio id, transaction id) —
//    only display data (name, ISIN when present, type, ...).
//  - Never include the tax report / Freistellungsauftrag (explicitly excluded
//    — see the plan's open question #2).
//  - Numbers are rounded to keep the payload compact (2 decimals; fractions
//    like weights/returns are surfaced as *Pct fields, already ×100).
//  - Every section past the holdings rides a feature flag. The caller passes a
//    section only when its flag is ON, and an absent section is simply left out
//    of the JSON rather than emitted empty — an empty array reads to a model as
//    "the user has none of these", which is a different claim from "this app
//    does not have that feature turned on".
//  - A figure the app itself refuses to invent stays null here (the statutory
//    pension without a reference Rentenwert). The prompt tells the model to say
//    a figure is unavailable rather than fill the gap.

import type { HoldingSummary } from "../finance/portfolio";
import type { PortfolioRiskStats, PortfolioStats } from "../finance/stats";
import type { Slice } from "../finance/allocation";
import type { Asset, SavingsPlan } from "../types";
import { assetPriceKey } from "../types";
import { nextOccurrence } from "../finance/savings-plans";
import type { Locale } from "../i18n/locale";

export interface PortfolioContextInput {
  baseCurrency: string;
  /** "YYYY-MM-DD", from lib/finance/dates.ts's today(). */
  today: string;
  holdings: HoldingSummary[];
  /** All assets (used to resolve savings-plan instrument names). */
  assets: Asset[];
  savingsPlans: SavingsPlan[];
  /** assetPriceKey(asset) -> annual dividend yield (fraction), from the
   *  catalog. Entries are only included for assets with a known yield. */
  dividendYields?: Record<string, number>;
  /** lib/finance/stats.ts's portfolioOrBenchmarkStats/estimatePortfolioStats
   *  output — per-asset + blended expected-return/volatility. Null when there
   *  are no holdings to estimate from. */
  portfolioStats: PortfolioStats | null;
  /** lib/finance/stats.ts's portfolioRiskStats output — portfolio-level
   *  Sharpe/Sortino/volatility. Null when there are no holdings. */
  riskStats: PortfolioRiskStats | null;
  /** Portfolio-level beta/alpha vs an external market benchmark (the same
   *  composite-levels computation as the risk page's KPI tiles — see
   *  components/analysis/risk-view.tsx). `alpha` is an annualised fraction.
   *  Null/absent when history or benchmark data is unavailable. */
  benchmark?: { name: string; beta: number; alpha: number } | null;
  /** lib/finance/allocation.ts's byAssetClass/byCurrency/byCountry output. */
  allocationByClass: Slice[];
  allocationByCurrency: Slice[];
  allocationByCountry: Slice[];
  /** Balance accounts & liabilities (ROADMAP #1), id-free, base-currency
   *  signed balances (liabilities negative). Absent/empty when the user has
   *  no accounts. */
  accounts?: {
    name: string;
    kind: string;
    currency: string;
    isLiability: boolean;
    /** Signed current balance in the base currency (liabilities negative). */
    balance: number;
  }[];
  /** Planned income/expenses (flag `plannedCashflow`), id-free: the recurring
   *  figures normalised to one month plus the next upcoming payments. Only
   *  passed when the flag is on; absent otherwise. */
  planned?: {
    /** `plannedMonthlyTotals` output, base currency. */
    monthly: { income: number; expense: number; net: number };
    /** The next expected payments, signed, base currency. */
    upcoming: { name: string; date: string; amount: number }[];
  } | null;

  // Everyday money and planning. Each rides its own feature flag and is only
  // passed when that flag is on, so the assistant never answers from a surface
  // the user cannot open. All id-free and already in the base currency, same
  // rule as everything above.

  /** Spending ledger (flag `spending`): the trailing twelve months, and where
   *  the money actually went. Transfers are excluded upstream -- moving money
   *  between your own accounts is not income and not an expense. */
  spending?: {
    trailing12m: { income: number; expense: number };
    /** Expense per category over the same window, largest first. */
    topCategories: { name: string; amount: number }[];
  } | null;
  /** Monthly caps and the current month's usage (flag `budgets`). */
  budgets?: { category: string; cap: number; spent: number }[] | null;
  /** Recurring commitments (flag `contracts`), each normalised to one month so
   *  a yearly insurance and a monthly subscription can be compared. */
  contracts?: { name: string; monthly: number; interval: string; nextDue: string | null }[] | null;
  /** Named goals (flag `goals`). Composite parents arrive already derived from
   *  their parts, so nothing is counted twice. */
  goals?:
    | {
        name: string;
        target: number;
        current: number;
        targetDate: string | null;
      }[]
    | null;
  /** Retirement provision (flag `pension`), monthly figures in today's money.
   *  `statutoryMonthly` is null when there is no reference Rentenwert to value
   *  the points with -- report the points, never invent the euros. */
  pension?: {
    totalPoints: number;
    statutoryMonthly: number | null;
    privateMonthly: number;
    totalMonthly: number | null;
    retirementYear: number | null;
  } | null;
  /** FIRE planner (flag `firePlanner`), base currency. */
  fire?: {
    annualExpenses: number;
    withdrawalRate: number;
    fireNumber: number;
    leanFireNumber: number;
    fatFireNumber: number;
    /** Null when the current contribution never reaches the target. */
    yearsToFire: number | null;
  } | null;
  /** Instruments followed without a position (flag `watchlist`), names only. */
  watchlist?: string[];
  /** assetPriceKey(asset) -> "Group=Value" strings from the user's own tag
   *  groups. Values are user data and are passed through verbatim. */
  tags?: Record<string, string[]>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fraction (e.g. 0.0532) -> percent, 2 decimals (5.32). */
function pct2(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

/** Slices -> {label: percentOfTotal}, dropping the raw currency values. */
function slicesToPct(slices: Slice[]): Record<string, number> {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const s of slices) out[s.label] = pct2(s.value / total);
  return out;
}

/**
 * Assemble the compact JSON portfolio snapshot. Deliberately a plain
 * `JSON.stringify` (no pretty-printing) to keep the system prompt small.
 */
export function buildPortfolioContext(input: PortfolioContextInput): string {
  const totalValue = input.holdings.reduce((s, h) => s + h.marketValue, 0);

  const holdings = input.holdings
    .filter((h) => h.marketValue !== 0 || h.position.shares !== 0)
    .map((h) => {
      const key = assetPriceKey(h.asset);
      const yieldFrac = input.dividendYields?.[key];
      const tags = input.tags?.[key];
      return {
        name: h.asset.name,
        type: h.asset.type,
        ...(h.asset.isin ? { isin: h.asset.isin } : {}),
        qty: round2(h.position.shares),
        value: round2(h.marketValue),
        weightPct: totalValue > 0 ? pct2(h.marketValue / totalValue) : 0,
        unrealizedPL: round2(h.unrealizedPL),
        unrealizedPLPct: pct2(h.unrealizedPLPercent),
        realizedPL: round2(h.realizedPL),
        ...(yieldFrac != null ? { dividendYieldPct: pct2(yieldFrac) } : {}),
        ...(tags?.length ? { tags } : {}),
      };
    });

  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const savingsPlans = input.savingsPlans.map((p) => ({
    instrument: assetById.get(p.assetId)?.name ?? "?",
    amount: round2(p.amount),
    interval: p.interval,
    nextRun: nextOccurrence(p, input.today),
    paused: !p.active,
  }));

  const risk = input.riskStats
    ? {
        expectedReturnPct: pct2(input.riskStats.annualReturn),
        volatilityPct: pct2(input.riskStats.volatility),
        downsideDeviationPct: pct2(input.riskStats.downsideDeviation),
        sharpe: input.riskStats.sharpe != null ? round2(input.riskStats.sharpe) : null,
        sortino: input.riskStats.sortino != null ? round2(input.riskStats.sortino) : null,
      }
    : null;

  const vsBenchmark = input.benchmark
    ? {
        name: input.benchmark.name,
        beta: round2(input.benchmark.beta),
        alphaPct: pct2(input.benchmark.alpha),
      }
    : null;

  const perAsset = (input.portfolioStats?.perAsset ?? []).map((a) => ({
    name: a.name,
    weightPct: pct2(a.weight),
    expectedReturnPct: pct2(a.annualReturn),
    volatilityPct: pct2(a.annualVol),
  }));

  const accounts = (input.accounts ?? []).map((a) => ({
    name: a.name,
    kind: a.kind,
    currency: a.currency,
    isLiability: a.isLiability,
    balance: round2(a.balance),
  }));
  const accountsNet = accounts.reduce((s, a) => s + a.balance, 0);

  const planned = input.planned
    ? {
        monthly: {
          income: round2(input.planned.monthly.income),
          expense: round2(input.planned.monthly.expense),
          net: round2(input.planned.monthly.net),
        },
        upcoming: input.planned.upcoming.map((p) => ({
          name: p.name,
          date: p.date,
          amount: round2(p.amount),
        })),
      }
    : null;

  const spending = input.spending
    ? {
        trailing12m: {
          income: round2(input.spending.trailing12m.income),
          expense: round2(input.spending.trailing12m.expense),
        },
        topCategories: input.spending.topCategories.map((c) => ({
          name: c.name,
          amount: round2(c.amount),
        })),
      }
    : null;

  const budgets = (input.budgets ?? []).map((b) => ({
    category: b.category,
    cap: round2(b.cap),
    spent: round2(b.spent),
  }));

  const contracts = (input.contracts ?? []).map((c) => ({
    name: c.name,
    monthly: round2(c.monthly),
    interval: c.interval,
    nextDue: c.nextDue,
  }));

  const goals = (input.goals ?? []).map((g) => ({
    name: g.name,
    target: round2(g.target),
    current: round2(g.current),
    progressPct: g.target > 0 ? pct2(g.current / g.target) : 0,
    targetDate: g.targetDate,
  }));

  const pension = input.pension
    ? {
        totalPoints: round2(input.pension.totalPoints),
        statutoryMonthly:
          input.pension.statutoryMonthly != null ? round2(input.pension.statutoryMonthly) : null,
        privateMonthly: round2(input.pension.privateMonthly),
        totalMonthly:
          input.pension.totalMonthly != null ? round2(input.pension.totalMonthly) : null,
        retirementYear: input.pension.retirementYear,
      }
    : null;

  const fire = input.fire
    ? {
        annualExpenses: round2(input.fire.annualExpenses),
        withdrawalRatePct: pct2(input.fire.withdrawalRate),
        fireNumber: round2(input.fire.fireNumber),
        leanFireNumber: round2(input.fire.leanFireNumber),
        fatFireNumber: round2(input.fire.fatFireNumber),
        yearsToFire: input.fire.yearsToFire != null ? round2(input.fire.yearsToFire) : null,
      }
    : null;

  const context = {
    baseCurrency: input.baseCurrency,
    today: input.today,
    totalValue: round2(totalValue),
    // Net worth = holdings market value plus every account signed by liability.
    ...(accounts.length ? { netWorth: round2(totalValue + accountsNet) } : {}),
    holdings,
    ...(accounts.length ? { accounts } : {}),
    ...(planned ? { plannedCashflows: planned } : {}),
    ...(spending ? { spending } : {}),
    ...(budgets.length ? { budgets } : {}),
    ...(contracts.length ? { recurringPayments: contracts } : {}),
    ...(goals.length ? { goals } : {}),
    ...(pension ? { pension } : {}),
    ...(fire ? { fire } : {}),
    ...(input.watchlist?.length ? { watchlist: input.watchlist } : {}),
    savingsPlans,
    risk:
      risk || perAsset.length > 0
        ? { portfolio: risk, perAsset, ...(vsBenchmark ? { vsBenchmark } : {}) }
        : null,
    allocation: {
      byClass: slicesToPct(input.allocationByClass),
      byCurrency: slicesToPct(input.allocationByCurrency),
      byCountry: slicesToPct(input.allocationByCountry),
    },
  };

  return JSON.stringify(context);
}

/**
 * Wrap the context JSON with the assistant's operating instructions: ground
 * portfolio answers in the data, stay in scope for general finance
 * questions, never give investment advice, and reply in the user's locale
 * (with the correct register).
 */
export function buildSystemPrompt(contextJson: string, locale: Locale): string {
  return [
    "You are FinTrack's portfolio assistant, embedded in the app the user already has open.",
    "For questions about the user's actual portfolio, use the JSON data below and never invent holdings, numbers, or facts not present in it. If a portfolio figure the user asks about is not in the data, say plainly that it is not available in the current snapshot.",
    "General finance and investing questions (e.g. what beta, volatility, or the Sharpe ratio means, how ETFs or dividends work) ARE in scope: explain the concept clearly, and relate it to the user's data when that helps. Never refuse a question merely because the answer is not in the JSON.",
    "You are not a financial or investment advisor. Your answers are model output based on the data below, not investment advice, and never a recommendation to buy, sell, or hold any specific financial instrument.",
    `Always answer in the user's locale language (locale code: "${locale}"), regardless of the language the data's labels happen to be in.`,
    'When answering in German, always address the user with the informal "du" (never "Sie"); when answering in Spanish, use the informal "tú".',
    "Keep answers concise and concrete, citing the actual figures below where it helps.",
    "",
    "Portfolio data (JSON):",
    contextJson,
  ].join("\n");
}
