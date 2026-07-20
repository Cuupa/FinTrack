import { describe, expect, it } from "vitest";
import {
  fundVorabpauschale,
  estimateVorabpauschaleByYear,
  type VorabEstimateInput,
} from "../lib/finance/tax";
import type { Asset, Transaction } from "../lib/types";
import type { HistoryPoint } from "../lib/history/history";

function tx(
  p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price" | "date">,
): Transaction {
  return { id: Math.random().toString(36), assetId: "a", portfolioId: "p1", fee: 0, tax: 0, ...p };
}

function asset(over: Partial<Asset> & Pick<Asset, "id" | "type">): Asset {
  return { isin: null, wkn: null, symbol: null, name: over.id, currency: null, notes: null, ...over };
}

/** A flat-then-up native price series usable by priceAtFrom. */
function series(points: [string, number][]): HistoryPoint[] {
  return points.map(([date, close]) => ({ date, close }));
}

describe("fundVorabpauschale (per fund, per year)", () => {
  it("Basisertrag = startValue * basiszins * 0.7 when the fund gains enough", () => {
    // 10000 * 0.0255 * 0.7 = 178.50, gain is large, no distributions
    const v = fundVorabpauschale({ startValue: 10000, endValue: 12000, distributions: 0 }, 0.0255);
    expect(v).toBeCloseTo(178.5, 6);
  });

  it("is zero when the Basiszins is negative", () => {
    expect(fundVorabpauschale({ startValue: 10000, endValue: 12000, distributions: 0 }, -0.0045)).toBe(0);
  });

  it("is capped at the fund's value gain in a down year", () => {
    // Basisertrag 178.50, but the fund only rose by 50 -> capped to 50
    const v = fundVorabpauschale({ startValue: 10000, endValue: 10050, distributions: 0 }, 0.0255);
    expect(v).toBeCloseTo(50, 6);
  });

  it("is zero when the fund fell (no value gain)", () => {
    expect(fundVorabpauschale({ startValue: 10000, endValue: 9000, distributions: 0 }, 0.0255)).toBe(0);
  });

  it("distributions reduce the Basisertrag, floored at zero", () => {
    // Basisertrag 178.50, distributions 200 -> below zero -> 0
    expect(fundVorabpauschale({ startValue: 10000, endValue: 12000, distributions: 200 }, 0.0255)).toBe(0);
    // distributions 100 -> 78.50
    expect(
      fundVorabpauschale({ startValue: 10000, endValue: 12000, distributions: 100 }, 0.0255),
    ).toBeCloseTo(78.5, 6);
  });
});

describe("estimateVorabpauschaleByYear", () => {
  const etf = asset({ id: "a", type: "ETF", isin: "IE00B4L5Y983" });
  const base: Omit<VorabEstimateInput, "currentYear" | "basiszinsByYear"> = {
    assets: [etf],
    txs: [tx({ assetId: "a", type: "BUY", quantity: 100, price: 100, date: "2022-06-01" })],
    // 100 shares * 100 at 2023 start, * 120 at 2023 end
    histories: {
      IE00B4L5Y983: series([
        ["2022-06-01", 100],
        ["2023-01-02", 100],
        ["2023-12-29", 120],
        ["2024-01-02", 120],
        ["2024-12-30", 130],
      ]),
    },
    fxHistory: {},
    spotFx: {},
    base: "EUR",
    dividends: {},
  };

  it("estimates a completed year: startValue 10000 * 0.0255 * 0.7 = 178.50", () => {
    const out = estimateVorabpauschaleByYear({
      ...base,
      basiszinsByYear: { "2023": 0.0255 },
      currentYear: 2026,
    });
    expect(out["2023"]).toBeCloseTo(178.5, 6);
  });

  it("excludes the current (incomplete) year", () => {
    const out = estimateVorabpauschaleByYear({
      ...base,
      basiszinsByYear: { "2023": 0.0255, "2026": 0.02 },
      currentYear: 2026,
    });
    expect(out["2026"]).toBeUndefined();
    expect(out["2023"]).toBeGreaterThan(0);
  });

  it("excludes funds with no position at the start of the year", () => {
    // Bought mid-2023, so nothing held on 2023-01-01
    const out = estimateVorabpauschaleByYear({
      ...base,
      txs: [tx({ assetId: "a", type: "BUY", quantity: 100, price: 100, date: "2023-07-01" })],
      basiszinsByYear: { "2023": 0.0255 },
      currentYear: 2026,
    });
    expect(out["2023"]).toBeUndefined();
  });

  it("skips a fund with no usable history series", () => {
    const out = estimateVorabpauschaleByYear({
      ...base,
      histories: {},
      basiszinsByYear: { "2023": 0.0255 },
      currentYear: 2026,
    });
    expect(out["2023"]).toBeUndefined();
  });

  it("ignores non-ETF assets", () => {
    const stock = asset({ id: "s", type: "STOCK", isin: "US0378331005" });
    const out = estimateVorabpauschaleByYear({
      ...base,
      assets: [stock],
      txs: [tx({ assetId: "s", type: "BUY", quantity: 100, price: 100, date: "2022-06-01" })],
      histories: {
        US0378331005: series([
          ["2023-01-02", 100],
          ["2023-12-29", 120],
        ]),
      },
      basiszinsByYear: { "2023": 0.0255 },
      currentYear: 2026,
    });
    expect(out["2023"]).toBeUndefined();
  });

  it("sums across multiple funds in a year", () => {
    const etf2 = asset({ id: "b", type: "ETF", isin: "IE00BK5BQT80" });
    const out = estimateVorabpauschaleByYear({
      ...base,
      assets: [etf, etf2],
      txs: [
        tx({ assetId: "a", type: "BUY", quantity: 100, price: 100, date: "2022-06-01" }),
        tx({ assetId: "b", type: "BUY", quantity: 100, price: 100, date: "2022-06-01" }),
      ],
      histories: {
        IE00B4L5Y983: series([
          ["2022-12-30", 100],
          ["2023-12-29", 120],
        ]),
        IE00BK5BQT80: series([
          ["2022-12-30", 100],
          ["2023-12-29", 120],
        ]),
      },
      basiszinsByYear: { "2023": 0.0255 },
      currentYear: 2026,
    });
    expect(out["2023"]).toBeCloseTo(357, 6); // 178.50 * 2
  });
});
