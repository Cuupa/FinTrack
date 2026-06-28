import { describe, expect, it } from "vitest";
import { xirr, portfolioIRR } from "../lib/finance/irr";
import { netFlows, periodReturns, riskMetrics } from "../lib/finance/returns";
import { realizedByMonth, topMovers } from "../lib/finance/trades";
import { dividendsFromEvents, totalDividends } from "../lib/finance/dividends";
import type { Asset, Transaction } from "../lib/types";
import type { HoldingSummary, SeriesPoint } from "../lib/finance/portfolio";

function asset(over: Partial<Asset> & Pick<Asset, "id">): Asset {
  return {
    isin: null,
    wkn: null,
    symbol: null,
    name: over.id,
    type: "STOCK",
    currency: "EUR",
    notes: null,
    ...over,
  };
}
function tx(p: Partial<Transaction> & Pick<Transaction, "assetId" | "type" | "quantity" | "price" | "date">): Transaction {
  return { id: Math.random().toString(36), fee: 0, ...p };
}

describe("xirr / portfolioIRR", () => {
  it("recovers ~10% for a 1-year double-up-ish flow", () => {
    const r = xirr([
      { amount: -100, date: "2024-01-01" },
      { amount: 110, date: "2025-01-01" },
    ]);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(0.1, 2);
  });

  it("portfolioIRR appends current value as the final inflow", () => {
    const r = portfolioIRR([{ amount: -100, date: "2024-01-01" }], 110);
    // value dated ~today, so >100 over ~1y+ → positive
    expect((r as number) > 0).toBe(true);
    expect(portfolioIRR([], 100)).toBeNull();
    expect(portfolioIRR([{ amount: -100, date: "2024-01-01" }], 0)).toBeNull();
  });
});

describe("netFlows", () => {
  it("signs buys positive (money in) and sells negative", () => {
    const assets = [asset({ id: "a" })];
    const flows = netFlows(assets, [
      tx({ assetId: "a", type: "BUY", quantity: 10, price: 10, fee: 1, date: "2025-01-01" }),
      tx({ assetId: "a", type: "SELL", quantity: 5, price: 12, fee: 1, date: "2025-02-01" }),
    ]);
    expect(flows[0].amount).toBeCloseTo(101, 6); // 10*10 + 1
    expect(flows[1].amount).toBeCloseTo(-59, 6); // -(5*12 - 1)
  });
});

describe("periodReturns", () => {
  it("is contribution-adjusted (a pure deposit is ~0% return)", () => {
    // Value jumps 0 → 100 purely from a 100 deposit on the first day.
    const series: SeriesPoint[] = [
      { date: "2025-01-01", value: 100 },
      { date: "2025-03-31", value: 100 },
    ];
    const flows = [{ date: "2025-01-01", amount: 100 }];
    const [q] = periodReturns(series, flows, "quarter");
    expect(q.label).toBe("Q1");
    expect(Math.abs(q.ret)).toBeLessThan(0.01);
  });

  it("measures growth net of flows for a later period", () => {
    const series: SeriesPoint[] = [
      { date: "2025-01-01", value: 100 }, // Q1 start
      { date: "2025-03-31", value: 100 },
      { date: "2025-04-01", value: 100 }, // Q2 start (carries Q1's ending value)
      { date: "2025-06-30", value: 165 }, // Q2 end
    ];
    const flows = [
      { date: "2025-01-01", amount: 100 }, // opening deposit
      { date: "2025-05-15", amount: 50 }, // mid-Q2 deposit
    ];
    const q2 = periodReturns(series, flows, "quarter").find((r) => r.label === "Q2")!;
    // (165 - 100 - 50) / (100 + 25) = 15/125 = 0.12
    expect(q2.ret).toBeCloseTo(0.12, 6);
  });
});

describe("riskMetrics annualisation", () => {
  // Same return path sampled daily vs. every other day must annualise to the
  // same volatility — i.e. annualisation is driven by real spacing, not a fixed
  // 365 (the bug the audit fixed).
  it("is invariant to series point spacing", () => {
    // i.i.d.-ish daily returns from a deterministic LCG, so downsampling
    // doesn't systematically cancel (unlike an anti-correlated wiggle).
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5; // ~uniform in [-0.5, 0.5]
    };
    const daily: SeriesPoint[] = [];
    let v = 0;
    for (let d = 0; d < 400; d++) {
      const iso = new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10);
      v = (1 + v) * (1 + rnd() * 0.02) - 1;
      daily.push({ date: iso, value: v });
    }
    const everyOther = daily.filter((_, i) => i % 2 === 0);
    const a = riskMetrics(daily).volatility;
    const b = riskMetrics(everyOther).volatility;
    // With spacing-aware annualisation the two agree closely; the old fixed-365
    // code differed by ≈√2.
    expect(b).toBeGreaterThan(a * 0.75);
    expect(b).toBeLessThan(a * 1.25);
  });

  it("reports a peak-to-trough drawdown", () => {
    const series: SeriesPoint[] = [
      { date: "2025-01-01", value: 0 },
      { date: "2025-01-08", value: 0.2 }, // peak
      { date: "2025-01-15", value: -0.1 }, // trough from 1.2 -> 0.9
      { date: "2025-01-22", value: 0.05 },
    ];
    const m = riskMetrics(series);
    // (0.9 - 1.2) / 1.2 = -0.25
    expect(m.maxDrawdown).toBeCloseTo(0.25, 6);
    expect(m.maxDrawdownDays).toBeGreaterThanOrEqual(7);
  });
});

describe("realizedByMonth", () => {
  it("attributes realised P&L to the sell month", () => {
    const assets = [asset({ id: "a" })];
    const rows = realizedByMonth(assets, [
      tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
      tx({ assetId: "a", type: "SELL", quantity: 5, price: 150, date: "2025-03-20" }),
    ]);
    expect(rows).toEqual([{ month: "2025-03", realized: 250 }]); // (150-100)*5
  });
});

describe("topMovers", () => {
  it("splits winners and losers by total P&L", () => {
    const h = (id: string, pl: number): HoldingSummary =>
      ({
        asset: asset({ id }),
        position: { shares: 1 },
        unrealizedPL: pl,
        realizedPL: 0,
        unrealizedPLPercent: pl / 100,
      }) as unknown as HoldingSummary;
    const { wins, losses } = topMovers([h("win", 300), h("loss", -200), h("flat", 0)]);
    expect(wins.map((m) => m.id)).toEqual(["win"]);
    expect(losses.map((m) => m.id)).toEqual(["loss"]);
  });
});

describe("dividends", () => {
  it("scales payouts by shares held on the pay date", () => {
    const txs = [
      tx({ assetId: "a", type: "BUY", quantity: 10, price: 1, date: "2025-01-01" }),
    ];
    const pay = dividendsFromEvents([{ date: "2025-06-01", amount: 0.5 }], txs);
    expect(pay).toHaveLength(1);
    expect(pay[0].total).toBe(5); // 0.5 * 10
    expect(totalDividends(pay)).toBe(5);
  });

  it("ignores events before any shares were held (accumulating → none)", () => {
    expect(dividendsFromEvents([], [])).toEqual([]);
  });
});
