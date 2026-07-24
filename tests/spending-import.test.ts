import { describe, expect, it } from "vitest";
import { parseSpendingCsv, spendingFingerprint } from "@/lib/import/spending-csv";
import { reconcileSpending } from "@/lib/import/spending-reconcile";
import type { SpendingTransaction } from "@/lib/types";

function tx(overrides: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "acc-1",
    categoryId: null,
    date: "2026-01-05",
    amount: -42.5,
    payee: "Rewe",
    note: null,
    recurringId: null,
    ...overrides,
  };
}

describe("parseSpendingCsv", () => {
  it("parses a German bank export (semicolon, comma decimal, dd.mm.yyyy)", () => {
    const csv = [
      "Buchungstag;Wertstellung;Umsatzart;Begünstigter/Zahlungspflichtiger;Verwendungszweck;Betrag",
      "05.01.2026;05.01.2026;Kartenzahlung;REWE Markt;Einkauf;-42,50",
      "07.01.2026;07.01.2026;Gehalt;Arbeitgeber GmbH;Gehalt Januar;2500,00",
    ].join("\n");
    const { rows, invalid } = parseSpendingCsv(csv);
    expect(invalid).toBe(0);
    expect(rows).toEqual([
      { date: "2026-01-05", amount: -42.5, payee: "REWE Markt", note: "Einkauf" },
      { date: "2026-01-07", amount: 2500, payee: "Arbeitgeber GmbH", note: "Gehalt Januar" },
    ]);
  });

  it("parses a generic English export (comma, dot decimal, ISO date)", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-02-01,Coffee Shop,-4.50",
      "2026-02-03,Employer Payroll,3000.00",
    ].join("\n");
    const { rows, invalid } = parseSpendingCsv(csv);
    expect(invalid).toBe(0);
    expect(rows).toEqual([
      { date: "2026-02-01", amount: -4.5, payee: "Coffee Shop", note: null },
      { date: "2026-02-03", amount: 3000, payee: "Employer Payroll", note: null },
    ]);
  });

  it("falls back to the note column as payee when there's no dedicated payee column", () => {
    const csv = [
      "Buchungstag;Verwendungszweck;Betrag",
      "05.01.2026;Miete Januar;-900,00",
    ].join("\n");
    const { rows } = parseSpendingCsv(csv);
    expect(rows).toEqual([{ date: "2026-01-05", amount: -900, payee: "Miete Januar", note: "Miete Januar" }]);
  });

  it("counts rows with a missing/zero amount or unparseable date as invalid, not as a zero-row", () => {
    const csv = [
      "Date,Description,Amount",
      "2026-02-01,Coffee Shop,-4.50",
      "not-a-date,Broken Row,-4.50",
      "2026-02-05,Zero Row,0",
      ",No Date,-5.00",
    ].join("\n");
    const { rows, invalid } = parseSpendingCsv(csv);
    expect(rows).toHaveLength(1);
    expect(invalid).toBe(3);
  });

  it("returns no rows when the header has no recognisable date/amount columns", () => {
    const csv = ["Foo,Bar", "1,2"].join("\n");
    const { rows, invalid } = parseSpendingCsv(csv);
    expect(rows).toEqual([]);
    expect(invalid).toBe(0);
  });
});

describe("spendingFingerprint", () => {
  it("scopes the fingerprint to the account so the same statement differs per account", () => {
    const row = { date: "2026-01-05", amount: -42.5, payee: "Rewe" };
    const fpA = spendingFingerprint("acc-1", row);
    const fpB = spendingFingerprint("acc-2", row);
    expect(fpA).not.toBe(fpB);
    expect(spendingFingerprint("acc-1", row)).toBe(fpA);
  });

  it("is case/whitespace-insensitive on the payee", () => {
    const a = spendingFingerprint("acc-1", { date: "2026-01-05", amount: -42.5, payee: "Rewe" });
    const b = spendingFingerprint("acc-1", { date: "2026-01-05", amount: -42.5, payee: "  rewe  " });
    expect(a).toBe(b);
  });
});

describe("reconcileSpending", () => {
  it("marks a row new when nothing matches", () => {
    const parsed = [{ date: "2026-01-05", amount: -42.5, payee: "Rewe", note: null }];
    const rec = reconcileSpending(parsed, "acc-1", [], new Set());
    expect(rec).toEqual([
      {
        parsed: parsed[0],
        fingerprint: spendingFingerprint("acc-1", parsed[0]),
        status: "new",
        existing: undefined,
      },
    ]);
  });

  it("marks a row imported when its fingerprint was already recorded", () => {
    const parsed = [{ date: "2026-01-05", amount: -42.5, payee: "Rewe", note: null }];
    const fp = spendingFingerprint("acc-1", parsed[0]);
    const rec = reconcileSpending(parsed, "acc-1", [], new Set([fp]));
    expect(rec[0].status).toBe("imported");
  });

  it("marks a row conflict when an existing transaction on the same account/day/amount exists", () => {
    const existing = [tx({ id: "e1", accountId: "acc-1", date: "2026-01-05", amount: -42.5 })];
    const parsed = [{ date: "2026-01-05", amount: -42.5, payee: "REWE Markt", note: null }];
    const rec = reconcileSpending(parsed, "acc-1", existing, new Set());
    expect(rec[0].status).toBe("conflict");
    expect(rec[0].existing).toBe(existing[0]);
  });

  it("never matches a conflict against a different account's transaction", () => {
    const existing = [tx({ id: "e1", accountId: "acc-2", date: "2026-01-05", amount: -42.5 })];
    const parsed = [{ date: "2026-01-05", amount: -42.5, payee: "Rewe", note: null }];
    const rec = reconcileSpending(parsed, "acc-1", existing, new Set());
    expect(rec[0].status).toBe("new");
  });

  it("tolerates a small rounding difference in amount as still a conflict", () => {
    const existing = [tx({ id: "e1", accountId: "acc-1", date: "2026-01-05", amount: -42.5 })];
    const parsed = [{ date: "2026-01-05", amount: -42.504, payee: "Rewe", note: null }];
    const rec = reconcileSpending(parsed, "acc-1", existing, new Set());
    expect(rec[0].status).toBe("conflict");
  });
});
