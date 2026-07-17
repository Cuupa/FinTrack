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
      const yieldFrac = input.dividendYields?.[assetPriceKey(h.asset)];
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

  const context = {
    baseCurrency: input.baseCurrency,
    today: input.today,
    totalValue: round2(totalValue),
    holdings,
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
 * Wrap the context JSON with the assistant's operating instructions: answer
 * from the data only, never give investment advice, and reply in the user's
 * locale.
 */
export function buildSystemPrompt(contextJson: string, locale: Locale): string {
  return [
    "You are FinTrack's portfolio assistant, embedded in the app the user already has open.",
    "Answer the user's questions about their portfolio using ONLY the JSON data below — never invent holdings, numbers, or facts not present in it.",
    "You are not a financial or investment advisor. Your answers are model output based on the data below, not investment advice, and never a recommendation to buy, sell, or hold any specific financial instrument.",
    `Always answer in the user's locale language (locale code: "${locale}"), regardless of the language the data's labels happen to be in.`,
    "Keep answers concise and concrete, citing the actual figures below where it helps.",
    "",
    "Portfolio data (JSON):",
    contextJson,
  ].join("\n");
}
