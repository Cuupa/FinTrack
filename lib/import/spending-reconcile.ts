// Reconcile parsed bank-statement rows against a target account's existing
// spending transactions: new, a conflict with an existing transaction (same
// day + amount, different payee/note), or already imported (its fingerprint
// was recorded on a previous import). Mirrors lib/import/reconcile.ts's shape
// for the investment-import flow, over the spending row shape instead.

import type { SpendingTransaction } from "../types";
import { spendingFingerprint, type ParsedSpendingRow } from "./spending-csv";

export type SpendingRowStatus = "new" | "conflict" | "imported";

export interface ReconciledSpendingRow {
  parsed: ParsedSpendingRow;
  fingerprint: string;
  status: SpendingRowStatus;
  /** The existing transaction a conflict was matched against. */
  existing?: SpendingTransaction;
}

export function reconcileSpending(
  parsed: ParsedSpendingRow[],
  accountId: string,
  existing: SpendingTransaction[],
  importedFingerprints: Set<string>,
): ReconciledSpendingRow[] {
  // Only the target account's own transactions are candidates -- a coffee
  // shop charge on one account can't conflict with a lookalike row on another.
  const forAccount = existing.filter((t) => t.accountId === accountId);
  const byDay = new Map<string, SpendingTransaction[]>();
  for (const t of forAccount) {
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }

  return parsed.map((p) => {
    const fp = spendingFingerprint(accountId, p);
    if (importedFingerprints.has(fp)) {
      return { parsed: p, fingerprint: fp, status: "imported" as const };
    }
    const candidates = byDay.get(p.date) ?? [];
    const match = candidates.find((t) => Math.abs(t.amount - p.amount) <= 0.01);
    return {
      parsed: p,
      fingerprint: fp,
      status: match ? ("conflict" as const) : ("new" as const),
      existing: match,
    };
  });
}
