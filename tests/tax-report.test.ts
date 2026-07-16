import { describe, expect, it } from "vitest";
import { abgeltungRate, taxYearBreakdown, type TaxSettings, type YearDividends } from "../lib/finance/tax";
import type { Asset, Transaction } from "../lib/types";
import type { ValuationContext } from "../lib/finance/portfolio";

function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price" | "date">): Transaction {
  return { id: Math.random().toString(36), assetId: "a", portfolioId: "p1", fee: 0, tax: 0, ...p };
}

function asset(over: Partial<Asset> & Pick<Asset, "id" | "type">): Asset {
  return { isin: null, wkn: null, symbol: null, name: over.id, currency: null, notes: null, ...over };
}

const DEFAULT_SETTINGS: TaxSettings = {
  allowance: 1000,
  churchTaxRate: 0,
  applyTeilfreistellung: false,
  vorabpauschale: {},
  withheldOverride: {},
};
const noDividends: Record<string, YearDividends> = {};

describe("abgeltungRate", () => {
  it("is 26.375% with no church tax", () => {
    expect(abgeltungRate(0)).toBeCloseTo(0.26375, 10);
  });

  it("scales with church tax rate", () => {
    expect(abgeltungRate(0.08)).toBeCloseTo((1 / 4.08) * 1.135, 10);
    expect(abgeltungRate(0.09)).toBeCloseTo((1 / 4.09) * 1.145, 10);
  });
});

describe("taxYearBreakdown", () => {
  it("reduces the taxable gain by the sell fee but not by the withheld tax", () => {
    const stock = asset({ id: "a", type: "STOCK" });
    const rows = taxYearBreakdown(
      [stock],
      [
        tx({ type: "BUY", quantity: 10, price: 100, fee: 10, date: "2025-01-05" }),
        tx({ type: "SELL", quantity: 5, price: 150, fee: 5, tax: 40, date: "2025-06-01" }),
      ],
      noDividends,
      DEFAULT_SETTINGS,
    );
    expect(rows).toHaveLength(1);
    const y = rows[0];
    // avg cost = (10*100+10)/10 = 101/share
    // taxableGain = 5*150 - 5(fee) - 5*101 = 750 - 5 - 505 = 240 (tax not subtracted)
    expect(y.stockGains).toBeCloseTo(240, 6);
    expect(y.taxWithheld).toBeCloseTo(40, 6);
    expect(y.kapitalertraege).toBeCloseTo(240, 6);
  });

  it("applies Teilfreistellung to fund gains only when enabled", () => {
    const etf = asset({ id: "a", type: "ETF" });
    const txs = [
      tx({ type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
      tx({ type: "SELL", quantity: 10, price: 150, date: "2025-06-01" }),
    ];
    const off = taxYearBreakdown([etf], txs, noDividends, DEFAULT_SETTINGS)[0];
    expect(off.fundGains).toBeCloseTo(500, 6);
    expect(off.kapitalertraege).toBeCloseTo(500, 6);

    const on = taxYearBreakdown(
      [etf],
      txs,
      noDividends,
      { ...DEFAULT_SETTINGS, applyTeilfreistellung: true },
    )[0];
    expect(on.fundGains).toBeCloseTo(500, 6); // raw gain, pre-TF, unchanged
    expect(on.kapitalertraege).toBeCloseTo(350, 6); // 500 * 0.7
    expect(on.teilfreistellungApplied).toBe(true);
  });

  it("floors the Aktien pot at 0 on a loss without touching the sonstige pot", () => {
    const stock = asset({ id: "a", type: "STOCK" });
    const etf = asset({ id: "b", type: "ETF" });
    const rows = taxYearBreakdown(
      [stock, etf],
      [
        tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ assetId: "a", type: "SELL", quantity: 10, price: 80, date: "2025-06-01" }), // -200 loss
        tx({ assetId: "b", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ assetId: "b", type: "SELL", quantity: 10, price: 150, date: "2025-06-02" }), // +500 gain
      ],
      noDividends,
      DEFAULT_SETTINGS,
    );
    const y = rows[0];
    expect(y.stockGains).toBeCloseTo(-200, 6);
    expect(y.fundGains).toBeCloseTo(500, 6);
    // Aktien-Verlusttopf is not netted against the sonstige-Topf (simplified,
    // per-pot loss carryforward is out of scope).
    expect(y.kapitalertraege).toBeCloseTo(500, 6);
  });

  it("caps allowanceUsed at kapitalertraege when income is below the Sparerpauschbetrag", () => {
    const stock = asset({ id: "a", type: "STOCK" });
    const rows = taxYearBreakdown(
      [stock],
      [
        tx({ type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ type: "SELL", quantity: 10, price: 130, date: "2025-06-01" }), // +300
      ],
      noDividends,
      DEFAULT_SETTINGS, // allowance 1000
    );
    const y = rows[0];
    expect(y.kapitalertraege).toBeCloseTo(300, 6);
    expect(y.allowanceUsed).toBeCloseTo(300, 6);
    expect(y.taxableAfterAllowance).toBe(0);
    expect(y.estimatedTax).toBe(0);
  });

  it("routes CRYPTO/COMMODITY sells to privateSale, never into kapitalertraege", () => {
    const crypto = asset({ id: "a", type: "CRYPTO" });
    const rows = taxYearBreakdown(
      [crypto],
      [
        tx({ type: "BUY", quantity: 1, price: 1000, date: "2025-01-05" }),
        tx({ type: "SELL", quantity: 1, price: 1500, date: "2025-06-01" }),
      ],
      noDividends,
      DEFAULT_SETTINGS,
    );
    const y = rows[0];
    expect(y.privateSale).toBeCloseTo(500, 6);
    expect(y.kapitalertraege).toBe(0);
    expect(y.stockGains).toBe(0);
    expect(y.fundGains).toBe(0);
  });

  it("buckets cash INTEREST as income in the year received, per year", () => {
    const cash = asset({ id: "a", type: "CASH" });
    const rows = taxYearBreakdown(
      [cash],
      [
        tx({ type: "BUY", quantity: 1000, price: 1, date: "2024-01-01" }),
        tx({ type: "INTEREST", quantity: 25, price: 1, date: "2024-12-31" }),
        tx({ type: "INTEREST", quantity: 30, price: 1, date: "2025-06-01" }),
      ],
      noDividends,
      DEFAULT_SETTINGS,
    );
    expect(rows.map((r) => r.year)).toEqual(["2025", "2024"]);
    const y2024 = rows.find((r) => r.year === "2024")!;
    const y2025 = rows.find((r) => r.year === "2025")!;
    expect(y2024.interest).toBeCloseTo(25, 6);
    expect(y2025.interest).toBeCloseTo(30, 6);
    expect(y2024.kapitalertraege).toBeCloseTo(25, 6);
  });

  it("flows real dividend events into dividendsStock/dividendsFund with Teilfreistellung applied to fund dividends", () => {
    const rows = taxYearBreakdown(
      [],
      [],
      { "2024": { stock: 100, fund: 200 } },
      { ...DEFAULT_SETTINGS, applyTeilfreistellung: true },
    );
    expect(rows).toHaveLength(1);
    const y = rows[0];
    expect(y.year).toBe("2024");
    expect(y.dividendsStock).toBeCloseTo(100, 6);
    expect(y.dividendsFund).toBeCloseTo(140, 6); // 200 * 0.7
    expect(y.kapitalertraege).toBeCloseTo(240, 6); // 100 + 140
  });

  it("sorts years newest first across transaction and dividend-only years", () => {
    const rows = taxYearBreakdown(
      [],
      [],
      { "2022": { stock: 10, fund: 0 }, "2025": { stock: 20, fund: 0 }, "2023": { stock: 5, fund: 0 } },
      DEFAULT_SETTINGS,
    );
    expect(rows.map((r) => r.year)).toEqual(["2025", "2023", "2022"]);
  });

  it("applies Teilfreistellung to a manually entered Vorabpauschale like fund income, and the year exists solely because of it", () => {
    const rows = taxYearBreakdown(
      [],
      [],
      noDividends,
      { ...DEFAULT_SETTINGS, applyTeilfreistellung: true, vorabpauschale: { "2024": 100 } },
    );
    expect(rows).toHaveLength(1);
    const y = rows[0];
    expect(y.year).toBe("2024");
    expect(y.vorabpauschale).toBeCloseTo(70, 6); // 100 * 0.7
    expect(y.kapitalertraege).toBeCloseTo(70, 6);
    expect(y.allowanceUsed).toBeCloseTo(70, 6);
    expect(y.taxableAfterAllowance).toBe(0);
  });

  it("leaves a manually entered Vorabpauschale untouched when Teilfreistellung is off", () => {
    const rows = taxYearBreakdown(
      [],
      [],
      noDividends,
      { ...DEFAULT_SETTINGS, applyTeilfreistellung: false, vorabpauschale: { "2024": 100 } },
    );
    expect(rows).toHaveLength(1);
    const y = rows[0];
    expect(y.vorabpauschale).toBeCloseTo(100, 6);
    expect(y.kapitalertraege).toBeCloseTo(100, 6);
  });

  it("overrides the computed withheld tax and still exposes the computed value separately", () => {
    const stock = asset({ id: "a", type: "STOCK" });
    const rows = taxYearBreakdown(
      [stock],
      [
        tx({ type: "BUY", quantity: 10, price: 100, fee: 10, date: "2025-01-05" }),
        tx({ type: "SELL", quantity: 5, price: 150, fee: 5, tax: 40, date: "2025-06-01" }),
      ],
      noDividends,
      { ...DEFAULT_SETTINGS, withheldOverride: { "2025": 999 } },
    );
    expect(rows).toHaveLength(1);
    const y = rows[0];
    expect(y.taxWithheldComputed).toBeCloseTo(40, 6);
    expect(y.taxWithheld).toBeCloseTo(999, 6); // override wins
  });

  it("without an override, taxWithheld equals the computed value", () => {
    const stock = asset({ id: "a", type: "STOCK" });
    const rows = taxYearBreakdown(
      [stock],
      [
        tx({ type: "BUY", quantity: 10, price: 100, fee: 10, date: "2025-01-05" }),
        tx({ type: "SELL", quantity: 5, price: 150, fee: 5, tax: 40, date: "2025-06-01" }),
      ],
      noDividends,
      DEFAULT_SETTINGS,
    );
    const y = rows[0];
    expect(y.taxWithheld).toBeCloseTo(40, 6);
    expect(y.taxWithheldComputed).toBeCloseTo(40, 6);
  });

  it("a year with only a withheld override and no other events still appears", () => {
    const rows = taxYearBreakdown(
      [],
      [],
      noDividends,
      { ...DEFAULT_SETTINGS, withheldOverride: { "2023": 50 } },
    );
    expect(rows).toHaveLength(1);
    const y = rows[0];
    expect(y.year).toBe("2023");
    expect(y.taxWithheld).toBeCloseTo(50, 6);
    expect(y.taxWithheldComputed).toBe(0);
    expect(y.kapitalertraege).toBe(0);
  });

  it("converts a non-base-currency asset's gain via the ValuationContext spot rate", () => {
    const stock = asset({ id: "a", type: "STOCK", currency: "USD" });
    const v: ValuationContext = { base: "EUR", fx: { USD: 0.9 } };
    const rows = taxYearBreakdown(
      [stock],
      [
        tx({ type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ type: "SELL", quantity: 10, price: 150, date: "2025-06-01" }),
      ],
      noDividends,
      DEFAULT_SETTINGS,
      v,
    );
    // (10*150 - 10*100) USD = 500 USD -> * 0.9 = 450 EUR
    expect(rows[0].stockGains).toBeCloseTo(450, 6);
  });
});

describe("taxYearBreakdown — per-broker Freistellungsauftrag (portfolioAllowances)", () => {
  it("falls back to the single global allowance when portfolioAllowances is unset or empty", () => {
    const stock = asset({ id: "a", type: "STOCK" });
    const txs = [
      tx({ type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
      tx({ type: "SELL", quantity: 10, price: 130, date: "2025-06-01" }), // +300
    ];
    const unset = taxYearBreakdown([stock], txs, noDividends, DEFAULT_SETTINGS)[0];
    const empty = taxYearBreakdown(
      [stock],
      txs,
      noDividends,
      { ...DEFAULT_SETTINGS, portfolioAllowances: {} },
    )[0];
    for (const y of [unset, empty]) {
      expect(y.allowanceUsed).toBeCloseTo(300, 6); // min(1000, 300)
      expect(y.taxableAfterAllowance).toBe(0);
      expect(y.allowanceByPortfolio).toBeUndefined();
    }
  });

  it("caps allowanceUsed per broker: unused allowance at one broker does not offset another broker's excess gains", () => {
    // p1: gain 1500, registered allowance 1000 -> excess of 500 unshielded.
    // p2: gain 300, registered allowance 1000 -> 700 left over, but p2's own
    // gain is already fully covered so there is nothing pooled for that
    // leftover to apply to (no dividends/Vorabpauschale, no unregistered
    // portfolio) — it must NOT reach across to cover p1's excess.
    const a = asset({ id: "a", type: "STOCK" });
    const b = asset({ id: "b", type: "STOCK" });
    const rows = taxYearBreakdown(
      [a, b],
      [
        tx({ assetId: "a", portfolioId: "p1", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ assetId: "a", portfolioId: "p1", type: "SELL", quantity: 10, price: 250, date: "2025-06-01" }), // +1500
        tx({ assetId: "b", portfolioId: "p2", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ assetId: "b", portfolioId: "p2", type: "SELL", quantity: 10, price: 130, date: "2025-06-02" }), // +300
      ],
      noDividends,
      { ...DEFAULT_SETTINGS, portfolioAllowances: { p1: 1000, p2: 1000 } },
    );
    const y = rows[0];
    expect(y.kapitalertraege).toBeCloseTo(1800, 6);
    expect(y.allowanceUsed).toBeCloseTo(1300, 6); // 1000 (p1, capped) + 300 (p2, full)
    expect(y.taxableAfterAllowance).toBeCloseTo(500, 6); // p1's uncovered 500 stays taxable
    expect(y.allowanceByPortfolio).toEqual(
      expect.arrayContaining([
        { portfolioId: "p1", used: 1000, registered: 1000 },
        { portfolioId: "p2", used: 300, registered: 1000 },
      ]),
    );
  });

  it("applies a broker's leftover allowance against the pooled remainder (dividends), not against another broker", () => {
    // p1: gain 200, registered allowance 1000 -> 800 left over.
    // Pooled real dividends of 500 are not portfolio-attributable, so the
    // leftover from p1 applies there instead.
    const stock = asset({ id: "a", type: "STOCK" });
    const rows = taxYearBreakdown(
      [stock],
      [
        tx({ portfolioId: "p1", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ portfolioId: "p1", type: "SELL", quantity: 10, price: 120, date: "2025-06-01" }), // +200
      ],
      { "2025": { stock: 500, fund: 0 } },
      { ...DEFAULT_SETTINGS, portfolioAllowances: { p1: 1000 } },
    );
    const y = rows[0];
    expect(y.kapitalertraege).toBeCloseTo(700, 6); // 200 + 500
    expect(y.allowanceUsed).toBeCloseTo(700, 6); // 200 (p1) + 500 (pooled, from p1's leftover)
    expect(y.taxableAfterAllowance).toBe(0);
    expect(y.allowanceByPortfolio).toEqual([{ portfolioId: "p1", used: 200, registered: 1000 }]);
  });

  it("never shields gains booked at a portfolio with no registered allowance, even when another broker has leftover", () => {
    // p1 has a registered allowance and no gains (all leftover); p2 has gains
    // but no registered allowance — p2's gains stay fully taxable because
    // they are portfolio-attributable, not part of the pooled remainder.
    const a = asset({ id: "a", type: "STOCK" });
    const b = asset({ id: "b", type: "STOCK" });
    const rows = taxYearBreakdown(
      [a, b],
      [
        tx({ assetId: "b", portfolioId: "p2", type: "BUY", quantity: 10, price: 100, date: "2025-01-05" }),
        tx({ assetId: "b", portfolioId: "p2", type: "SELL", quantity: 10, price: 140, date: "2025-06-01" }), // +400
      ],
      noDividends,
      { ...DEFAULT_SETTINGS, portfolioAllowances: { p1: 1000 } },
    );
    const y = rows[0];
    expect(y.kapitalertraege).toBeCloseTo(400, 6);
    expect(y.allowanceUsed).toBe(0); // p1 has nothing of its own to shield, p2 has no registered allowance
    expect(y.taxableAfterAllowance).toBeCloseTo(400, 6);
  });
});
