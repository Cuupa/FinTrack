// Reconcile parsed CSV rows against the existing portfolio: classify each row
// as new, a conflict with an existing transaction (fuzzy match, ignoring time),
// or already imported (its fingerprint was recorded on a previous import).

import type { Asset, Transaction } from "../types";
import { fingerprint, type ParsedTx } from "./csv";

export type RowStatus = "new" | "conflict" | "imported";

export interface ReconciledRow {
  parsed: ParsedTx;
  fingerprint: string;
  status: RowStatus;
  /** The existing transaction a conflict was matched against. */
  existing?: Transaction;
}

function keyOf(isin: string | null, wkn: string | null, symbol: string | null): string {
  return (isin || wkn || symbol || "").toUpperCase();
}

function within(a: number, b: number, rel: number, abs = 0): boolean {
  const diff = Math.abs(a - b);
  return diff <= abs || diff <= rel * Math.max(Math.abs(a), Math.abs(b));
}

export function reconcile(
  parsed: ParsedTx[],
  assets: Asset[],
  transactions: Transaction[],
  importedFingerprints: Set<string>,
): ReconciledRow[] {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  // Index existing transactions by asset identifier for quick fuzzy lookup.
  const byKey = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const a = assetById.get(tx.assetId);
    if (!a) continue;
    const k = keyOf(a.isin, a.wkn, a.symbol);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(tx);
    byKey.set(k, list);
  }

  return parsed.map((p) => {
    const fp = fingerprint(p);
    if (importedFingerprints.has(fp)) {
      return { parsed: p, fingerprint: fp, status: "imported" as const };
    }
    const candidates = byKey.get(keyOf(p.isin, p.wkn, p.symbol)) ?? [];
    const match = candidates.find(
      (tx) =>
        tx.type === p.type &&
        tx.date.slice(0, 10) === p.date.slice(0, 10) &&
        within(tx.quantity, p.quantity, 0.02) &&
        within(tx.price, p.price, 0.02, 1),
    );
    return {
      parsed: p,
      fingerprint: fp,
      status: match ? ("conflict" as const) : ("new" as const),
      existing: match,
    };
  });
}
