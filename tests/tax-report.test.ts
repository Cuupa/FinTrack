import { describe, expect, it } from "vitest";
import { taxYearReport } from "../lib/finance/trades";
import type { Asset, Transaction } from "../lib/types";

function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price" | "date">): Transaction {
  return { id: Math.random().toString(36), assetId: "a", portfolioId: "p1", fee: 0, tax: 0, ...p };
}

const stock: Asset = {
  id: "a",
  isin: "US0378331005",
  wkn: null,
  symbol: "AAPL",
  name: "Apple",
  type: "STOCK",
  currency: null,
  notes: null,
};

const cash: Asset = {
  id: "c",
  isin: null,
  wkn: null,
  symbol: null,
  name: "Cash",
  type: "CASH",
  currency: null,
  notes: null,
};

describe("taxYearReport", () => {
  it("attributes realized gains, fees and taxes to the sell's calendar year", () => {
    const rows = taxYearReport(
      [stock],
      [
        tx({ type: "BUY", quantity: 10, price: 100, fee: 10, date: "2024-03-01T10:00:00" }),
        tx({ type: "SELL", quantity: 5, price: 150, fee: 5, tax: 40, date: "2025-06-01T10:00:00" }),
      ],
    );
    expect(rows.map((r) => r.year)).toEqual(["2025", "2024"]); // newest first
    const y2024 = rows.find((r) => r.year === "2024")!;
    expect(y2024.fees).toBe(10);
    expect(y2024.realizedGross).toBe(0);
    const y2025 = rows.find((r) => r.year === "2025")!;
    // avg cost 101/share → gross = 5*150 - 5*101 = 245
    expect(y2025.realizedGross).toBeCloseTo(245, 6);
    // net = gross - fee - tax = 245 - 5 - 40 = 200
    expect(y2025.realizedNet).toBeCloseTo(200, 6);
    expect(y2025.fees).toBe(5);
    expect(y2025.taxes).toBe(40);
  });

  it("counts cash interest as income in the year received", () => {
    const rows = taxYearReport(
      [cash],
      [
        tx({ assetId: "c", type: "BUY", quantity: 1000, price: 1, date: "2025-01-01T00:00:00" }),
        tx({ assetId: "c", type: "INTEREST", quantity: 25, price: 1, date: "2025-12-31T00:00:00" }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe("2025");
    expect(rows[0].interest).toBe(25);
    // A withdrawal is not a taxable event; nothing realized from deposits.
    expect(rows[0].realizedGross).toBe(0);
  });
});
