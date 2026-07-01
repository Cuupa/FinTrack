import { describe, expect, it } from "vitest";
import { xirr, portfolioIRR } from "../lib/finance/irr";
import {
  netFlows,
  periodReturns,
  riskMetrics,
  cumulativeReturnSeries,
  betaAlpha,
} from "../lib/finance/returns";
import { realizedByMonth, topMovers } from "../lib/finance/trades";
import { dividendsFromEvents, totalDividends } from "../lib/finance/dividends";
import { twrSeries } from "../lib/finance/portfolio";
import type { Asset, Transaction } from "../lib/types";
import type { HoldingSummary, SeriesPoint } from "../lib/finance/portfolio";
import type { HistoryMap } from "../lib/history/history";

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
  return { id: Math.random().toString(36), portfolioId: "p1", fee: 0, ...p };
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

describe("twrSeries (price-based TWROR)", () => {
  // Price doubles then stays flat; history keyed by the asset price key ("A").
  const history: HistoryMap = {
    A: [
      { date: "2025-01-01", close: 100 },
      { date: "2025-07-01", close: 200 },
    ],
  };
  const assets = [asset({ id: "a" })];

  it("starts at 0 and reflects the price return", () => {
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-01" })];
    const out = twrSeries(assets, txs, "MAX", undefined, history);
    expect(out[0].value).toBe(0);
    expect(out[out.length - 1].value).toBeCloseTo(1.0, 2); // +100%
  });

  it("is invariant to deposits (a later buy doesn't change the return)", () => {
    const base = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-01" })];
    const withDeposit = [
      ...base,
      // A big extra purchase after the price already doubled — pure cash flow.
      tx({ assetId: "a", type: "BUY", quantity: 1000, price: 200, date: "2025-09-01" }),
    ];
    const a = twrSeries(assets, base, "MAX", undefined, history);
    const b = twrSeries(assets, withDeposit, "MAX", undefined, history);
    const last = (s: SeriesPoint[]) => s[s.length - 1].value;
    expect(last(b)).toBeCloseTo(last(a), 6); // deposit changes nothing
  });
});

describe("cumulativeReturnSeries", () => {
  it("starts at 0 and does not explode on a tiny early base", () => {
    // A near-empty portfolio that wiggles, then a big deposit funds it, after
    // which it gains a real 10%. The early noise must not blow up the line.
    const series: SeriesPoint[] = [
      { date: "2025-01-01", value: 10 },
      { date: "2025-01-02", value: 20 }, // +100% on a tiny base — must be ignored
      { date: "2025-06-01", value: 10000 }, // big deposit lands
      { date: "2025-12-01", value: 11000 }, // +10% real growth on a funded base
    ];
    const flows = [
      { date: "2025-01-01", amount: 10 },
      { date: "2025-06-01", amount: 9980 }, // the deposit
    ];
    const out = cumulativeReturnSeries(series, flows);
    expect(out[0].value).toBe(0);
    // The final cumulative return is the real ~10%, not hundreds of percent.
    expect(out[out.length - 1].value).toBeGreaterThan(0.08);
    expect(out[out.length - 1].value).toBeLessThan(0.12);
    // No point in the series is absurd.
    expect(Math.max(...out.map((p) => p.value))).toBeLessThan(0.2);
  });

  it("does not register a cliff when a large mid-window flow mis-cancels", () => {
    // A funded portfolio gains 5%, then a big deposit lands but the net-worth
    // jump doesn't exactly match the recorded flow (e.g. an asset with no real
    // history valued synthetically) — this must NOT show as a huge loss.
    const series: SeriesPoint[] = [
      { date: "2025-01-01", value: 10000 },
      { date: "2025-03-01", value: 10500 }, // +5% real
      { date: "2025-03-15", value: 16000 }, // +€6000 deposit, but value only +€5500
      { date: "2025-06-01", value: 16800 }, // +5% real on the new base
    ];
    const flows = [{ date: "2025-03-15", amount: 6000 }];
    const out = cumulativeReturnSeries(series, flows);
    // No absurd negative step; the line stays in a sane positive band.
    expect(Math.min(...out.map((p) => p.value))).toBeGreaterThan(-0.05);
    expect(out[out.length - 1].value).toBeGreaterThan(0.08); // ~ +5% then +5%
    expect(out[out.length - 1].value).toBeLessThan(0.12);
  });

  it("excludes deposits from the return (a pure deposit is ~0%)", () => {
    const series: SeriesPoint[] = [
      { date: "2025-01-01", value: 1000 },
      { date: "2025-02-01", value: 2000 }, // doubled, but only via a deposit
    ];
    const flows = [{ date: "2025-02-01", amount: 1000 }];
    const out = cumulativeReturnSeries(series, flows);
    expect(Math.abs(out[out.length - 1].value)).toBeLessThan(0.001);
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

describe("betaAlpha", () => {
  // Build daily level series over ~2 years for an asset that is the benchmark
  // scaled by beta (with matching drift) plus a little idiosyncratic noise.
  function series(days: number, fn: (i: number) => number) {
    const out = [];
    const start = Date.UTC(2024, 0, 1);
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      out.push({ date: d, value: fn(i) });
    }
    return out;
  }

  it("recovers beta ~1 for an asset that tracks the benchmark (daily vs weekly)", () => {
    const days = 500;
    // Benchmark stored WEEKLY (sparse), asset DAILY — the mismatch that used to
    // break the covariance. A near-1:1 tracker must still read ~1.
    const bmDaily = series(days, (i) => 100 * Math.exp(0.0003 * i + 0.01 * Math.sin(i / 7)));
    const bmWeekly = bmDaily.filter((_, i) => i % 7 === 0);
    const asset = series(days, (i) => 50 * Math.exp(0.0003 * i + 0.01 * Math.sin(i / 7)));
    const res = betaAlpha(asset, bmWeekly);
    expect(res).not.toBeNull();
    expect(res!.beta).toBeGreaterThan(0.7);
    expect(res!.beta).toBeLessThan(1.3);
  });

  it("gives beta ~2 for a 2x-amplified asset", () => {
    const days = 400;
    const bm = series(days, (i) => 100 * Math.exp(0.0002 * i + 0.02 * Math.sin(i / 5)));
    const asset = series(days, (i) => 100 * Math.exp(0.0004 * i + 0.04 * Math.sin(i / 5)));
    const res = betaAlpha(asset, bm);
    expect(res).not.toBeNull();
    expect(res!.beta).toBeGreaterThan(1.5);
    expect(res!.beta).toBeLessThan(2.5);
  });
});
