import { describe, expect, it } from "vitest";
import { validateBooking } from "@/lib/finance/spending";
import { formatAmountInput, currencySymbol, parseDecimal } from "@/lib/format";

describe("validateBooking", () => {
  const acc = "a1";

  it("rejects a missing amount before anything else", () => {
    const v = validateBooking("expense", { amount: NaN, accountId: acc, counterparty: "Rewe" });
    expect(v).toEqual({ ok: false, field: "amount", code: "amountMissing" });
  });

  it("rejects a non-positive amount", () => {
    expect(validateBooking("income", { amount: 0, accountId: acc, counterparty: "X" })).toMatchObject({
      field: "amount",
      code: "amountPositive",
    });
    expect(validateBooking("expense", { amount: -5, accountId: acc, counterparty: "X" })).toMatchObject({
      code: "amountPositive",
    });
  });

  it("requires a counterparty for expense and income", () => {
    expect(validateBooking("expense", { amount: 10, accountId: acc, counterparty: "" })).toEqual({
      ok: false,
      field: "counterparty",
      code: "counterpartyMissing",
    });
    // The caller trims before passing, so the validator only sees "".
    expect(validateBooking("income", { amount: 10, accountId: acc, counterparty: "" })).toMatchObject({
      field: "counterparty",
    });
  });

  it("passes a valid expense/income", () => {
    expect(validateBooking("expense", { amount: 12.5, accountId: acc, counterparty: "Rewe" })).toEqual({
      ok: true,
    });
  });

  it("requires a destination and rejects a self-transfer, never a counterparty", () => {
    expect(validateBooking("transfer", { amount: 10, accountId: acc, toAccountId: null })).toEqual({
      ok: false,
      field: "toAccount",
      code: "toAccountMissing",
    });
    expect(
      validateBooking("transfer", { amount: 10, accountId: acc, toAccountId: acc }),
    ).toMatchObject({ field: "toAccount", code: "sameAccount" });
    // A transfer never fails on a missing counterparty: it has none.
    expect(
      validateBooking("transfer", { amount: 10, accountId: acc, toAccountId: "a2", counterparty: "" }),
    ).toEqual({ ok: true });
  });
});

describe("currency input helpers", () => {
  it("round-trips a comma-decimal amount through parse then group-format (de)", () => {
    // parseDecimal is locale-tolerant; formatAmountInput groups with two
    // decimals. Under the test default (en) grouping uses a comma.
    expect(parseDecimal("1595")).toBe(1595);
    expect(parseDecimal("1595,00")).toBe(1595);
    expect(formatAmountInput(1595)).toBe("1,595.00");
  });

  it("extracts the bare currency symbol", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
  });
});
