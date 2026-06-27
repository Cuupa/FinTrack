// Dividends received, computed from REAL dividend events (from /api/dividends,
// keyed by price key) scaled by the shares held on each pay date. An
// accumulating fund has no events, so it shows no payouts.

import type { Transaction } from "../types";
import { sharesAt } from "./portfolio";

export interface DividendPayment {
  date: string;
  /** Per-share amount in the asset's currency. */
  perShare: number;
  shares: number;
  total: number;
}

export function totalDividends(payments: DividendPayment[]): number {
  return payments.reduce((s, p) => s + p.total, 0);
}

/**
 * Dividends actually received, from REAL dividend events (per share, in the
 * asset's currency) scaled by the shares held on each pay date. An accumulating
 * fund has no events, so this is empty — no phantom payouts.
 */
export function dividendsFromEvents(
  events: { date: string; amount: number }[],
  txs: Transaction[],
): DividendPayment[] {
  const out: DividendPayment[] = [];
  for (const e of events) {
    if (e.amount <= 0) continue;
    const shares = sharesAt(txs, e.date);
    if (shares > 0) {
      out.push({ date: e.date, perShare: e.amount, shares, total: e.amount * shares });
    }
  }
  return out;
}
