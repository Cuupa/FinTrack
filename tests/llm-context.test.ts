import { describe, expect, it } from "vitest";
import { buildPortfolioContext, buildSystemPrompt, type PortfolioContextInput } from "../lib/llm/context";
import type { HoldingSummary } from "../lib/finance/portfolio";
import type { PortfolioRiskStats, PortfolioStats } from "../lib/finance/stats";
import type { Asset, SavingsPlan } from "../lib/types";

function asset(over: Partial<Asset> & Pick<Asset, "id">): Asset {
  return {
    isin: null,
    wkn: null,
    symbol: null,
    name: "Test",
    currency: null,
    type: "STOCK",
    notes: null,
    ...over,
  };
}

function holding(over: Partial<HoldingSummary> & { asset: Asset }): HoldingSummary {
  return {
    position: { shares: 1, avgCost: 1, costBasis: 1, realizedPL: 0, totalFees: 0, totalTaxes: 0 },
    currency: "EUR",
    price: 1,
    rate: 1,
    marketValue: 0,
    costBasis: 0,
    unrealizedPL: 0,
    realizedPL: 0,
    unrealizedPLPercent: 0,
    syntheticPrice: false,
    ...over,
  } as HoldingSummary;
}

function plan(over: Partial<SavingsPlan>): SavingsPlan {
  return {
    id: "sp1",
    assetId: "a1",
    portfolioId: "p1",
    amount: 100,
    interval: "MONTHLY",
    startDate: "2026-01-15",
    active: true,
    lastRunDate: null,
    ...over,
  };
}

const vwceAsset = asset({ id: "a1", name: "Vanguard FTSE All-World", isin: "IE00BK5BQT80", type: "ETF" });
const btcAsset = asset({ id: "a2", name: "Bitcoin", symbol: "BTC", type: "CRYPTO" });

function baseInput(): PortfolioContextInput {
  const holdings: HoldingSummary[] = [
    holding({
      asset: vwceAsset,
      position: { shares: 12.345, avgCost: 90, costBasis: 1111.05, realizedPL: 0, totalFees: 0, totalTaxes: 0 },
      marketValue: 1300.456,
      costBasis: 1111.05,
      unrealizedPL: 189.406,
      realizedPL: 0,
      unrealizedPLPercent: 0.17046,
    }),
    holding({
      asset: btcAsset,
      position: { shares: 0.5, avgCost: 20000, costBasis: 10000, realizedPL: 50, totalFees: 0, totalTaxes: 0 },
      marketValue: 12000,
      costBasis: 10000,
      unrealizedPL: 2000,
      realizedPL: 50,
      unrealizedPLPercent: 0.2,
    }),
  ];

  const riskStats: PortfolioRiskStats = {
    annualReturn: 0.0721,
    volatility: 0.153,
    downsideDeviation: 0.09,
    sharpe: 0.34,
    sortino: 0.51,
    sampleMonths: 36,
    real: true,
  };

  const portfolioStats: PortfolioStats = {
    expectedReturn: 0.0721,
    volatility: 0.153,
    sampleYears: 3,
    perAsset: [
      { name: vwceAsset.name, weight: 0.098, annualReturn: 0.065, annualVol: 0.14 },
      { name: btcAsset.name, weight: 0.902, annualReturn: 0.12, annualVol: 0.6 },
    ],
    fromBenchmark: false,
    real: true,
    estimated: false,
  };

  return {
    baseCurrency: "EUR",
    today: "2026-07-17",
    holdings,
    assets: [vwceAsset, btcAsset],
    savingsPlans: [plan({ assetId: "a1", amount: 150.5, interval: "MONTHLY", active: true })],
    dividendYields: { [vwceAsset.isin as string]: 0.018 },
    portfolioStats,
    riskStats,
    benchmark: { name: "MSCI World", beta: 1.2345, alpha: 0.02345 },
    allocationByClass: [
      { label: "ETF", value: 1300.456 },
      { label: "CRYPTO", value: 12000 },
    ],
    allocationByCurrency: [{ label: "EUR", value: 13300.456 }],
    allocationByCountry: [{ label: "Unknown", value: 13300.456 }],
  };
}

describe("buildPortfolioContext", () => {
  it("includes key portfolio facts", () => {
    const json = buildPortfolioContext(baseInput());
    const parsed = JSON.parse(json);

    expect(parsed.baseCurrency).toBe("EUR");
    expect(parsed.today).toBe("2026-07-17");

    const names = parsed.holdings.map((h: { name: string }) => h.name);
    expect(names).toContain("Vanguard FTSE All-World");
    expect(names).toContain("Bitcoin");

    const vwce = parsed.holdings.find((h: { name: string }) => h.name === "Vanguard FTSE All-World");
    expect(vwce.isin).toBe("IE00BK5BQT80");
    expect(vwce.type).toBe("ETF");
    expect(vwce.dividendYieldPct).toBeCloseTo(1.8, 6);
    expect(vwce.value).toBeCloseTo(1300.46, 2);

    expect(parsed.savingsPlans).toEqual([
      { instrument: "Vanguard FTSE All-World", amount: 150.5, interval: "MONTHLY", nextRun: "2026-08-15", paused: false },
    ]);

    expect(parsed.risk.portfolio.sharpe).toBeCloseTo(0.34, 6);
    expect(parsed.risk.portfolio.expectedReturnPct).toBeCloseTo(7.21, 6);
    expect(parsed.risk.perAsset.map((a: { name: string }) => a.name)).toContain("Bitcoin");

    // Beta/alpha vs the external benchmark, rounded like everything else.
    expect(parsed.risk.vsBenchmark).toEqual({ name: "MSCI World", beta: 1.23, alphaPct: 2.35 });

    expect(parsed.allocation.byClass.ETF).toBeGreaterThan(0);
    expect(parsed.allocation.byClass.CRYPTO).toBeGreaterThan(0);
  });

  it("never includes internal ids or the tax report", () => {
    const json = buildPortfolioContext(baseInput());
    // Internal ids (asset/portfolio/transaction/savings-plan) never appear.
    expect(json).not.toContain("\"a1\"");
    expect(json).not.toContain("\"a2\"");
    expect(json).not.toContain("\"sp1\"");
    expect(json).not.toContain("\"p1\"");
    expect(json.toLowerCase()).not.toContain("freistellung");
    expect(json.toLowerCase()).not.toContain("vorabpauschale");
    expect(json.toLowerCase()).not.toContain("taxreport");
    expect(json.toLowerCase()).not.toContain("allowance");
  });

  it("rounds numbers to keep the payload compact", () => {
    const json = buildPortfolioContext(baseInput());
    const parsed = JSON.parse(json);
    const vwce = parsed.holdings.find((h: { name: string }) => h.name === "Vanguard FTSE All-World");
    expect(vwce.qty).toBe(12.35); // 12.345 rounded to 2dp
  });

  it("drops zero-position holdings", () => {
    const input = baseInput();
    input.holdings.push(
      holding({
        asset: asset({ id: "a3", name: "Closed position" }),
        position: { shares: 0, avgCost: 0, costBasis: 0, realizedPL: 30, totalFees: 0, totalTaxes: 0 },
        marketValue: 0,
        realizedPL: 30,
      }),
    );
    const parsed = JSON.parse(buildPortfolioContext(input));
    expect(parsed.holdings.map((h: { name: string }) => h.name)).not.toContain("Closed position");
  });

  it("omits vsBenchmark when beta/alpha are unavailable", () => {
    const input = baseInput();
    input.benchmark = null;
    const parsed = JSON.parse(buildPortfolioContext(input));
    expect(parsed.risk).not.toBeNull();
    expect("vsBenchmark" in parsed.risk).toBe(false);
  });

  it("omits risk when there are no stats", () => {
    const input = baseInput();
    input.portfolioStats = null;
    input.riskStats = null;
    const parsed = JSON.parse(buildPortfolioContext(input));
    expect(parsed.risk).toBeNull();
  });
});

describe("buildSystemPrompt", () => {
  it("wraps the JSON with the locale + non-advisor framing and embeds the JSON verbatim", () => {
    const json = buildPortfolioContext(baseInput());
    const prompt = buildSystemPrompt(json, "de");
    expect(prompt).toContain(json);
    expect(prompt).toContain('"de"');
    expect(prompt.toLowerCase()).toContain("not investment advice".split(" ")[0]); // "not" present
    expect(prompt.toLowerCase()).toContain("advisor");
  });
});
