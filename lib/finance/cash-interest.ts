// Cash-interest accrual math — pure, no React, no store access. Mirrors the
// savings-plan model (lib/finance/savings-plans.ts): a CASH asset's interest
// schedule is derived entirely from (interestRate, interestFrequency, the
// asset's transaction log) — nothing is precomputed or stored. Due interest is
// materialized as INTEREST transactions after an explicit review, exactly like
// due savings-plan occurrences become BUY/BOOKING transactions.

import type { Asset, InterestFrequency, Transaction } from "../types";
import { dateKey } from "./dates";

/** Hard cap on materialized interest payouts per asset per review, so a stale
 *  account created years ago can't explode into hundreds of rows at once. */
export const MAX_INTEREST_OCCURRENCES = 60;

/** Credits (compoundings) per year for each frequency — the divisor applied to
 *  the annual nominal rate to get one period's rate. */
const PERIODS_PER_YEAR: Record<InterestFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUAL: 1,
};

/** Clamp a (year, month0, day) to the month's real length -> YYYY-MM-DD. */
function ymd(year: number, month0: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(year, month0, Math.min(day, lastDay)));
  return d.toISOString().slice(0, 10);
}

/**
 * The k-th payout date (k = 1 is the first credit, one full period after the
 * anchor). Keeps the anchor's day-of-month, clamping to shorter months, like a
 * bank crediting interest on the same calendar day each period.
 */
function payoutDate(anchor: string, freq: InterestFrequency, k: number): string {
  const [y, m, d] = anchor.split("-").map(Number);
  const step = freq === "MONTHLY" ? 1 : freq === "QUARTERLY" ? 3 : 12;
  return ymd(y, m - 1 + step * k, d);
}

/** Round to 2 decimals (plain half-up), matching the money precision used
 *  when booking a transaction. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Signed quantity change of a CASH transaction: deposits, free bookings and
 *  interest credits add to the balance; withdrawals (SELL) subtract. CASH
 *  prices at a constant 1, so the summed quantity IS the balance. */
function signedQty(tx: Transaction): number {
  switch (tx.type) {
    case "BUY":
    case "BOOKING":
    case "INTEREST":
      return tx.quantity;
    case "SELL":
      return -tx.quantity;
    default:
      return 0;
  }
}

export interface DueInterest {
  /** Payout date (YYYY-MM-DD) the INTEREST transaction would be booked on. */
  date: string;
  /** Interest amount in the asset's currency (also the booked quantity, since
   *  CASH prices at 1). Always > 0. */
  amount: number;
}

/**
 * Interest payouts due for materialization on a CASH asset: every period
 * boundary strictly after the last booked INTEREST transaction (or after the
 * first deposit when none), up to and including `today`. Each payout's amount
 * is the running cash balance as of that date times the per-period rate, so
 * credits compound through the ones proposed earlier in the same batch. Zero
 * or negative balances yield no payout. Capped at MAX_INTEREST_OCCURRENCES.
 *
 * Returns [] unless the asset is CASH with a positive rate and a frequency and
 * at least one transaction (the anchor).
 */
export function dueInterest(
  asset: Asset,
  transactions: Transaction[],
  today: string,
  max = MAX_INTEREST_OCCURRENCES,
): DueInterest[] {
  if (asset.type !== "CASH") return [];
  const rate = asset.interestRate;
  const freq = asset.interestFrequency;
  if (!rate || rate <= 0 || !freq) return [];

  const txs = transactions
    .filter((t) => t.assetId === asset.id)
    .map((t) => ({ date: dateKey(t.date), qty: signedQty(t), type: t.type }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (txs.length === 0) return [];

  const anchor = txs[0].date;
  const lastBooked = txs.reduce<string | null>(
    (acc, t) => (t.type === "INTEREST" && (!acc || t.date > acc) ? t.date : acc),
    null,
  );

  const periodRate = rate / 100 / PERIODS_PER_YEAR[freq];
  // Running credits proposed in this batch, so each payout compounds on top of
  // the prior ones (they'd be booked as balance-increasing INTEREST txs).
  const credits: { date: string; amount: number }[] = [];
  const balanceOn = (date: string): number => {
    let bal = 0;
    for (const t of txs) if (t.date <= date) bal += t.qty;
    for (const c of credits) if (c.date <= date) bal += c.amount;
    return bal;
  };

  const out: DueInterest[] = [];
  for (let k = 1; out.length < max; k++) {
    const date = payoutDate(anchor, freq, k);
    if (date > today) break;
    if (lastBooked && date <= lastBooked) continue;
    const balance = balanceOn(date);
    if (balance <= 0) continue;
    const amount = round2(balance * periodRate);
    if (amount <= 0) continue;
    credits.push({ date, amount });
    out.push({ date, amount });
  }
  return out;
}

/** The next payout date strictly after `today` (for a "next credit" readout).
 *  Null when the asset isn't an active interest-bearing cash position. */
export function nextInterestDate(
  asset: Asset,
  transactions: Transaction[],
  today: string,
): string | null {
  if (asset.type !== "CASH" || !asset.interestRate || asset.interestRate <= 0 || !asset.interestFrequency)
    return null;
  const dates = transactions
    .filter((t) => t.assetId === asset.id)
    .map((t) => dateKey(t.date))
    .sort();
  if (dates.length === 0) return null;
  const anchor = dates[0];
  for (let k = 1; k <= 1000; k++) {
    const date = payoutDate(anchor, asset.interestFrequency, k);
    if (date > today) return date;
  }
  return null;
}
