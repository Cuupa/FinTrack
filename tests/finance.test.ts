import { describe, expect, it } from "vitest";
import { xirr, portfolioIRR } from "../lib/finance/irr";
import {
  netFlows,
  periodReturns,
  riskMetrics,
  cumulativeReturnSeries,
  betaAlpha,
  compositeLevelSeries,
} from "../lib/finance/returns";
import { realizedByMonth, topMovers } from "../lib/finance/trades";
import { dividendsFromEvents, totalDividends } from "../lib/finance/dividends";
import { assetPriceSeries, netWorthSeries, summarizeHolding, twrSeries } from "../lib/finance/portfolio";
import { assetAnnualStats, portfolioRiskStats } from "../lib/finance/stats";
import { dividendItemsFor } from "../lib/finance/prices";
import { assetPriceKey } from "../lib/types";
import type { Asset, Transaction } from "../lib/types";
import type { HoldingSummary, SeriesPoint } from "../lib/finance/portfolio";
import type { StatHolding } from "../lib/finance/stats";
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
  return { id: Math.random().toString(36), portfolioId: "p1", fee: 0, tax: 0, ...p };
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

describe("assetPriceSeries: synthetic flag (trust labeling)", () => {
  it("flags synthetic=true when the asset has no real history", () => {
    const out = assetPriceSeries(asset({ id: "a" }), "1M", undefined, {});
    expect(out.synthetic).toBe(true);
    expect(out.points.length).toBeGreaterThan(0);
  });

  it("flags synthetic=false and returns the real series when history exists", () => {
    const history: HistoryMap = {
      A: [
        { date: "2025-01-01", close: 100 },
        { date: "2025-07-01", close: 200 },
      ],
    };
    const out = assetPriceSeries(asset({ id: "a" }), "1M", undefined, history);
    expect(out.synthetic).toBe(false);
    expect(out.points).toEqual([
      { date: "2025-01-01", value: 100 },
      { date: "2025-07-01", value: 200 },
    ]);
  });
});

describe("netWorthSeries: containsSynthetic flag (trust labeling)", () => {
  const history: HistoryMap = {
    A: [
      { date: "2025-01-01", close: 100 },
      { date: "2025-07-01", close: 200 },
    ],
  };

  it("is false when every held asset's price is backed by real history", () => {
    const assets = [asset({ id: "a" })];
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-01" })];
    const { containsSynthetic } = netWorthSeries(assets, txs, "MAX", undefined, history);
    expect(containsSynthetic).toBe(false);
  });

  it("is true when a mix includes a holding with no real history", () => {
    // "b" has no entry in `history` — the fabricated synthetic series backs it.
    const assets = [asset({ id: "a" }), asset({ id: "b" })];
    const txs = [
      tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-01" }),
      tx({ assetId: "b", type: "BUY", quantity: 5, price: 50, date: "2025-01-01" }),
    ];
    const { containsSynthetic } = netWorthSeries(assets, txs, "MAX", undefined, history);
    expect(containsSynthetic).toBe(true);
  });
});

describe("summarizeHolding: syntheticPrice flag (trust labeling)", () => {
  it("is true when there's no live quote backing the current price", () => {
    const a = asset({ id: "a" });
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-01" })];
    const h = summarizeHolding(a, txs, { base: "EUR" });
    expect(h.syntheticPrice).toBe(true);
  });

  it("is false when a live quote is present", () => {
    const a = asset({ id: "a" });
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-01" })];
    const h = summarizeHolding(a, txs, { base: "EUR", live: { A: 123.45 } });
    expect(h.syntheticPrice).toBe(false);
  });

  it("is never true for CASH (its price of 1 is exact, not an estimate)", () => {
    const a = asset({ id: "c", type: "CASH" });
    const txs = [tx({ assetId: "c", type: "BUY", quantity: 100, price: 1, date: "2025-01-01" })];
    const h = summarizeHolding(a, txs, { base: "EUR" });
    expect(h.syntheticPrice).toBe(false);
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

  it("recovers beta ~1 and alpha ~0 against itself", () => {
    const days = 400;
    const s = series(days, (i) => 100 * Math.exp(0.0003 * i + 0.01 * Math.sin(i / 7)));
    const res = betaAlpha(s, s);
    expect(res).not.toBeNull();
    expect(res!.beta).toBeCloseTo(1, 6);
    expect(res!.alpha).toBeCloseTo(0, 6);
  });

  it("is scale-invariant: rescaling series `a` by a constant leaves beta/alpha unchanged", () => {
    // Both beta and alpha are computed from RETURNS (ratios of consecutive
    // values), so a constant multiplicative rescale of `a` cancels out. This
    // is the property the risk-view portfolio-level KPI tiles rely on: the
    // composite series is `a`'s levels normalised to start at 1.0, and must
    // still yield the exact same beta/alpha as `a`'s own (unnormalised) levels.
    const days = 400;
    const bm = series(days, (i) => 100 * Math.exp(0.00025 * i + 0.015 * Math.sin(i / 6)));
    const a = series(days, (i) => 50 * Math.exp(0.0004 * i + 0.03 * Math.sin(i / 6 + 0.4)));
    const scaled = a.map((p) => ({ date: p.date, value: p.value / a[0].value })); // normalised to 1.0
    const raw = betaAlpha(a, bm);
    const norm = betaAlpha(scaled, bm);
    expect(raw).not.toBeNull();
    expect(norm).not.toBeNull();
    expect(norm!.beta).toBeCloseTo(raw!.beta, 9);
    expect(norm!.alpha).toBeCloseTo(raw!.alpha, 9);
  });
});

describe("compositeLevelSeries", () => {
  function series(days: number, fn: (i: number) => number) {
    const out: SeriesPoint[] = [];
    const start = Date.UTC(2024, 0, 1);
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      out.push({ date: d, value: fn(i) });
    }
    return out;
  }

  it("returns empty for no usable (positive-weight, non-empty) items", () => {
    expect(compositeLevelSeries([])).toEqual([]);
    expect(compositeLevelSeries([{ levels: [], weight: 100 }])).toEqual([]);
    expect(
      compositeLevelSeries([{ levels: series(10, (i) => 100 + i), weight: 0 }]),
    ).toEqual([]);
  });

  it("with one holding, equals that holding's own levels normalised to 1.0 at the start", () => {
    // single-holding scope's betaAlpha is bit-identical to the table row's,
    // backed by betaAlpha's scale invariance (see the betaAlpha describe block).
    const levels = series(300, (i) => 50 * Math.exp(0.0003 * i + 0.02 * Math.sin(i / 9)));
    const composite = compositeLevelSeries([{ levels, weight: 1234 }]);
    expect(composite.length).toBe(levels.length);
    const base = levels[0].value;
    for (let i = 0; i < levels.length; i++) {
      expect(composite[i].date).toBe(levels[i].date);
      expect(composite[i].value).toBeCloseTo(levels[i].value / base, 9);
    }

    const bm = series(300, (i) => 100 * Math.exp(0.00025 * i + 0.015 * Math.sin(i / 6)));
    const rowBA = betaAlpha(levels, bm);
    const compositeBA = betaAlpha(composite, bm);
    expect(rowBA).not.toBeNull();
    expect(compositeBA).not.toBeNull();
    expect(compositeBA!.beta).toBeCloseTo(rowBA!.beta, 9);
    expect(compositeBA!.alpha).toBeCloseTo(rowBA!.alpha, 9);
  });

  it("value-weights two holdings and is dominated by the heavier one", () => {
    const flat = series(60, () => 100); // constant: normalised level stays 1.0 always
    const doubling = series(60, (i) => 100 * Math.exp((Math.log(2) / 59) * i)); // 100 -> 200
    // 90% flat / 10% doubling: composite should end close to 1.0 + 0.1*(2-1) = 1.1
    const composite = compositeLevelSeries([
      { levels: flat, weight: 900 },
      { levels: doubling, weight: 100 },
    ]);
    expect(composite.length).toBe(60);
    expect(composite[0].value).toBeCloseTo(1, 9);
    expect(composite[composite.length - 1].value).toBeCloseTo(1.1, 6);
  });

  it("aligns onto the intersection of dates when series have different windows", () => {
    const full = series(60, (i) => 100 + i); // day 0..59
    const shifted = full.slice(10, 50).map((p) => ({ ...p })); // day 10..49 only, same values/dates
    const composite = compositeLevelSeries([
      { levels: full, weight: 1 },
      { levels: shifted, weight: 1 },
    ]);
    expect(composite.length).toBe(40); // days 10..49
    expect(composite[0].date).toBe(full[10].date);
    expect(composite[composite.length - 1].date).toBe(full[49].date);
  });
});

describe("portfolioRiskStats", () => {
  // Real monthly history for one asset, well above MIN_REAL_MONTHS so the
  // real-history path (not the synthetic fallback) is exercised.
  const realAsset = asset({ id: "real-a", isin: "IE00REALHISTA1" });
  const realHistory: HistoryMap = {
    [assetPriceKey(realAsset)]: Array.from({ length: 30 }, (_, i) => {
      const y = 2022 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      return {
        date: `${y}-${String(m).padStart(2, "0")}-01`,
        close: 100 * (1 + 0.15 * Math.sin(i / 2.3)) * (1 + i * 0.01),
      };
    }),
  };

  it("matches assetAnnualStats for a single asset with real history", () => {
    const holdings: StatHolding[] = [{ asset: realAsset, marketValue: 1000 }];
    const pr = portfolioRiskStats(holdings, 2, realHistory);
    const ann = assetAnnualStats(realAsset, realHistory, 2);
    expect(pr).not.toBeNull();
    expect(pr!.volatility).toBeCloseTo(ann.vol, 9);
    if (pr!.sharpe == null || ann.sharpe == null) {
      expect(pr!.sharpe).toBeNull();
      expect(ann.sharpe).toBeNull();
    } else {
      expect(pr!.sharpe).toBeCloseTo(ann.sharpe, 9);
    }
  });

  it("matches assetAnnualStats for a single asset with no real history (synthetic)", () => {
    const synthAsset = asset({ id: "synth-a", isin: "IE00SYNTHASSETA" });
    const holdings: StatHolding[] = [{ asset: synthAsset, marketValue: 500 }];
    const pr = portfolioRiskStats(holdings, 2);
    const ann = assetAnnualStats(synthAsset, undefined, 2);
    expect(pr).not.toBeNull();
    expect(pr!.volatility).toBeCloseTo(ann.vol, 9);
    if (pr!.sharpe == null || ann.sharpe == null) {
      expect(pr!.sharpe).toBeNull();
      expect(ann.sharpe).toBeNull();
    } else {
      expect(pr!.sharpe).toBeCloseTo(ann.sharpe, 9);
    }
  });

  it("blends two assets' annualReturn between their individual returns, with bounded downside deviation", () => {
    // Deterministic, roughly mean-zero oscillating price paths (real history,
    // not the seeded synthetic walk) so the downside-vs-total-vol relationship
    // is stable rather than dependent on an arbitrary drift baked into a given
    // isin's synthetic series.
    const a = asset({ id: "two-a", isin: "IE00TWOASSETAAA" });
    const b = asset({ id: "two-b", isin: "IE00TWOASSETBBB" });
    const mk = (phase: number) =>
      Array.from({ length: 30 }, (_, i) => {
        const y = 2022 + Math.floor(i / 12);
        const m = (i % 12) + 1;
        return {
          date: `${y}-${String(m).padStart(2, "0")}-01`,
          close: 100 * (1 + 0.08 * Math.sin(i / 2.3 + phase)),
        };
      });
    const history: HistoryMap = {
      [assetPriceKey(a)]: mk(0),
      [assetPriceKey(b)]: mk(1.3),
    };
    const holdings: StatHolding[] = [
      { asset: a, marketValue: 600 },
      { asset: b, marketValue: 400 },
    ];
    const pr = portfolioRiskStats(holdings, 2, history);
    const annA = assetAnnualStats(a, history, 2);
    const annB = assetAnnualStats(b, history, 2);
    expect(pr).not.toBeNull();
    const lo = Math.min(annA.mean, annB.mean);
    const hi = Math.max(annA.mean, annB.mean);
    expect(pr!.annualReturn).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(pr!.annualReturn).toBeLessThanOrEqual(hi + 1e-9);
    expect(pr!.downsideDeviation).toBeLessThanOrEqual(pr!.volatility + 1e-9);
  });

  it("returns null for no holdings or all-zero market value", () => {
    expect(portfolioRiskStats([])).toBeNull();
    const zero = asset({ id: "zero-a", isin: "IE00ZEROVALUEAA" });
    expect(portfolioRiskStats([{ asset: zero, marketValue: 0 }])).toBeNull();
  });
});

describe("monte carlo withdrawal phase", () => {
  it("accumulates then draws the capital down", async () => {
    const { runMonteCarlo } = await import("../lib/finance/monte-carlo");
    const res = runMonteCarlo({
      initialCapital: 100000,
      monthlyContribution: 0,
      years: 5,
      expectedReturn: 0,
      volatility: 0,
      runs: 100,
      seed: 12345,
      withdrawalYears: 10,
      monthlyWithdrawal: 1000,
    });
    // Bands cover accumulation + withdrawal years.
    expect(res.bands.length).toBe(16);
    // Flat during accumulation (no return, no contribution), then depletes.
    expect(res.bands[5].median).toBeCloseTo(100000, 0);
    expect(res.bands[15].median).toBe(0); // 10y * 12k > 100k → depleted
  });
});

describe("dividendItemsFor", () => {
  it("includes STOCK and ETF assets", () => {
    const stock = asset({ id: "s1", type: "STOCK", isin: "US0378331005" });
    const etf = asset({ id: "e1", type: "ETF", isin: "IE00B4L5Y983" });

    const items = dividendItemsFor([stock, etf]);

    expect(items.map((i) => i.key)).toEqual([assetPriceKey(stock), assetPriceKey(etf)]);
  });

  it("excludes CRYPTO, COMMODITY and CASH assets (they never pay dividends)", () => {
    const crypto = asset({ id: "c1", type: "CRYPTO", symbol: "BTC" });
    const gold = asset({ id: "g1", type: "COMMODITY", symbol: "XAU" });
    const cash = asset({ id: "cash1", type: "CASH", symbol: "EUR" });

    expect(dividendItemsFor([crypto, gold, cash])).toEqual([]);
  });

  it("keeps only the equities from a mixed array", () => {
    const stock = asset({ id: "s1", type: "STOCK", isin: "US0378331005" });
    const gold = asset({ id: "g1", type: "COMMODITY", symbol: "XAU" });
    const crypto = asset({ id: "c1", type: "CRYPTO", symbol: "BTC" });

    const items = dividendItemsFor([stock, gold, crypto]);

    expect(items.map((i) => i.key)).toEqual([assetPriceKey(stock)]);
  });

  it("drops an equity quoteItemFor can't resolve (no catalog, no isin/symbol)", () => {
    const mystery = asset({ id: "m1", type: "STOCK", isin: null, wkn: null, symbol: null });

    expect(dividendItemsFor([mystery])).toEqual([]);
  });
});
