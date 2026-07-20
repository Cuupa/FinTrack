// Real stock splits (from /api/splits) not yet reflected in the transaction
// log, so the user can review and book them as SPLIT transactions.

import type { Transaction } from "../types";
import { dateKey } from "./dates";

export interface SplitEvent {
  date: string;
  /** New shares per old share — see lib/types.ts TransactionType SPLIT. */
  ratio: number;
}

/**
 * Detected split events not yet booked for this asset. No transactions means
 * no position exists yet (a watchlist/catalog instrument) — nothing to
 * correct, so this returns [] rather than prompting on an unheld instrument.
 * Otherwise, a split before the earliest transaction needed no correction
 * (the user's cost basis never saw the pre-split share count), and a split
 * already handled — an existing SPLIT transaction on the SAME DATE,
 * regardless of its ratio — is excluded: a deliberate manual entry at a
 * different ratio still counts as handled, never double-flagged. Returned
 * sorted ascending by date.
 */
export function pendingSplits(events: SplitEvent[], txs: Transaction[]): SplitEvent[] {
  if (txs.length === 0) return [];
  const earliest = txs.reduce(
    (min, t) => (dateKey(t.date) < min ? dateKey(t.date) : min),
    dateKey(txs[0].date),
  );
  const handledDates = new Set(
    txs.filter((t) => t.type === "SPLIT").map((t) => dateKey(t.date)),
  );
  return events
    .filter((e) => e.date >= earliest && !handledDates.has(e.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
