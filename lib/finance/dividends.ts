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

/**
 * 12-month dividend forecast: each per-share event of the trailing year
 * projected one year forward at the CURRENT share count. Deliberately
 * independent of received-payment history — a holding bought today still
 * forecasts its payer's trailing cadence.
 */
export function projectDividends(
  events: { date: string; amount: number }[],
  shares: number,
  t12mStart: string,
  todayISO: string,
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  for (const e of events) {
    if (e.date < t12mStart || e.amount <= 0) continue;
    const [y, m, d] = e.date.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    const date = new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastDay)))
      .toISOString()
      .slice(0, 10);
    if (date <= todayISO) continue;
    out.push({ date, amount: e.amount * shares });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

export interface ProjectedPayment {
  date: string;
  amount: number;
  /** True when `date` is a confirmed announced pay date (Yahoo calendar),
   *  not a trailing-cadence projection. The amount stays projected either way
   *  — Yahoo confirms the date, not the per-share figure. */
  confirmed: boolean;
}

/**
 * Fold one holding's confirmed announced pay date into its trailing
 * projection (COMPETITION.md F4): the earliest projected payment is re-dated
 * to the confirmed pay date and flagged confirmed; the rest are unchanged. A
 * past, absent, or projection-free announced date leaves the projection
 * untouched, so the projection always remains the fallback. Pure.
 */
export function applyAnnouncedDate(
  projected: { date: string; amount: number }[],
  announcedPayDate: string | null,
  todayISO: string,
): ProjectedPayment[] {
  const out: ProjectedPayment[] = projected.map((p) => ({ ...p, confirmed: false }));
  if (!announcedPayDate || announcedPayDate <= todayISO || out.length === 0) return out;
  // projectDividends returns ascending, so the earliest is index 0; scan to be
  // robust to any caller passing an unsorted list.
  let idx = 0;
  for (let i = 1; i < out.length; i++) if (out[i].date < out[idx].date) idx = i;
  out[idx] = { date: announcedPayDate, amount: out[idx].amount, confirmed: true };
  return out;
}
