import { describe, expect, it } from "vitest";
import { pendingSplits, type SplitEvent } from "../lib/finance/splits";
import type { Transaction } from "../lib/types";

function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price">): Transaction {
  return { id: "t", assetId: "a", portfolioId: "p1", fee: 0, tax: 0, date: "2025-01-01T00:00:00", ...p };
}

function ev(date: string, ratio = 2): SplitEvent {
  return { date, ratio };
}

describe("pendingSplits", () => {
  it("returns [] when the asset has no transactions (no position to correct)", () => {
    expect(pendingSplits([ev("2024-06-10")], [])).toEqual([]);
  });

  it("excludes an event dated before the earliest transaction", () => {
    const txs = [tx({ type: "BUY", quantity: 1, price: 100, date: "2024-01-01T00:00:00" })];
    const events = [ev("2023-12-01"), ev("2024-06-10")];
    expect(pendingSplits(events, txs)).toEqual([ev("2024-06-10")]);
  });

  it("excludes an event matching an existing SPLIT transaction's date, ratio matching", () => {
    const txs = [
      tx({ type: "BUY", quantity: 1, price: 100, date: "2024-01-01T00:00:00" }),
      tx({ type: "SPLIT", quantity: 2, price: 0, date: "2024-06-10T00:00:00" }),
    ];
    expect(pendingSplits([ev("2024-06-10", 2)], txs)).toEqual([]);
  });

  it("excludes an event matching an existing SPLIT transaction's date, even with a different ratio", () => {
    const txs = [
      tx({ type: "BUY", quantity: 1, price: 100, date: "2024-01-01T00:00:00" }),
      // The user booked a manual SPLIT at a different ratio on this date —
      // still counts as handled, must not be double-flagged.
      tx({ type: "SPLIT", quantity: 3, price: 0, date: "2024-06-10T00:00:00" }),
    ];
    expect(pendingSplits([ev("2024-06-10", 2)], txs)).toEqual([]);
  });

  it("returns eligible events sorted ascending by date", () => {
    const txs = [tx({ type: "BUY", quantity: 1, price: 100, date: "2024-01-01T00:00:00" })];
    const events = [ev("2024-06-10"), ev("2024-03-01")];
    expect(pendingSplits(events, txs)).toEqual([ev("2024-03-01"), ev("2024-06-10")]);
  });

  it("returns a mix: only eligible events survive, excluded ones are dropped", () => {
    const txs = [
      tx({ type: "BUY", quantity: 1, price: 100, date: "2024-02-01T00:00:00" }),
      tx({ type: "SPLIT", quantity: 4, price: 0, date: "2024-06-10T00:00:00" }),
    ];
    const events = [
      ev("2024-01-01"), // before earliest tx — excluded
      ev("2024-06-10"), // already handled (date match) — excluded
      ev("2024-09-01"), // eligible
      ev("2024-04-01"), // eligible
    ];
    expect(pendingSplits(events, txs)).toEqual([ev("2024-04-01"), ev("2024-09-01")]);
  });
});
