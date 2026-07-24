// Bank-statement CSV -> spending transactions (ROADMAP item #3, flag
// `spending`). Banks have no consistent export format, so this is a
// header-driven parser in the same spirit as csv.ts's `parseGeneric` fallback
// for broker exports -- but it's a parallel module, not a branch inside that
// one: a bank statement row (date/amount/payee/note) has nothing in common
// with a broker row (isin/type/quantity/price), so sharing one parser would
// mean threading two unrelated shapes through the same function. It does
// reuse csv.ts's quote-aware line splitting and lenient number/date parsing
// instead of duplicating that logic.

import { anyDate, anyNum, detectDelim, splitLine, toLines } from "./csv";

export interface ParsedSpendingRow {
  /** YYYY-MM-DD. */
  date: string;
  /** Signed, native currency: income positive, expense negative. */
  amount: number;
  payee: string;
  note: string | null;
}

/**
 * Header-driven parser for a bank statement CSV. Columns are located by
 * fuzzy header names (English + German); numbers/dates are parsed leniently
 * via the same helpers the generic broker parser uses. A row without a
 * parseable date or a nonzero amount is dropped and counted in `invalid`
 * (there's no broker-style `type` to validate against, so amount/date are
 * the whole guardrail).
 */
export function parseSpendingCsv(text: string): {
  rows: ParsedSpendingRow[];
  invalid: number;
} {
  const lines = toLines(text);
  if (lines.length < 2) return { rows: [], invalid: 0 };
  const delim = detectDelim(lines[0]);
  const header = splitLine(lines[0], delim);
  const find = (names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.toLowerCase().includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    date: find(["buchungstag", "buchungsdatum", "wertstellung", "datum", "booking date", "date"]),
    amount: find(["betrag", "umsatz", "amount", "value"]),
    payee: find([
      "beguenstigter/zahlungspflichtiger",
      "begünstigter/zahlungspflichtiger",
      "empfänger/zahlungspflichtiger",
      "empfaenger",
      "empfänger",
      "auftraggeber",
      "beguenstigter",
      "begünstigter",
      "payee",
      "merchant",
      "name",
      "description",
    ]),
    note: find(["verwendungszweck", "buchungstext", "purpose", "reference", "memo", "note"]),
  };
  // Needs at least a date and an amount column to be a statement export we
  // can meaningfully import.
  if (c.date < 0 || c.amount < 0) return { rows: [], invalid: 0 };

  const out: ParsedSpendingRow[] = [];
  let invalid = 0;
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], delim);
    const amount = anyNum(r[c.amount]);
    const date = anyDate(r[c.date]).slice(0, 10);
    if (!Number.isFinite(amount) || amount === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      invalid++;
      continue;
    }
    const note = c.note >= 0 ? r[c.note]?.trim() || null : null;
    const payee = (c.payee >= 0 && r[c.payee]?.trim()) || note || "";
    out.push({ date, amount, payee, note });
  }
  return { rows: out, invalid };
}

/**
 * Fingerprint scoped to the target account: a spending row carries no
 * cross-account identifier the way a broker row's ISIN/WKN does, so the same
 * statement re-imported against a different account is legitimately a
 * different set of transactions, not a duplicate.
 */
export function spendingFingerprint(accountId: string, row: Pick<ParsedSpendingRow, "date" | "amount" | "payee">): string {
  const amt = row.amount.toFixed(2);
  const payee = row.payee.trim().toUpperCase().slice(0, 60);
  return `${accountId}|${row.date}|${amt}|${payee}`;
}
