// Internal Rate of Return (annualised, XIRR-style) for irregularly-timed
// cashflows. Used in the asset detail panel.

import type { Transaction } from "../types";
import { parseISODate, today } from "./dates";

export interface CashFlow {
  amount: number;
  date: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function yearsBetween(a: string, b: string): number {
  return (parseISODate(b).getTime() - parseISODate(a).getTime()) / (DAY_MS * 365);
}

function npv(rate: number, flows: CashFlow[], t0: string): number {
  let sum = 0;
  for (const f of flows) {
    sum += f.amount / Math.pow(1 + rate, yearsBetween(t0, f.date));
  }
  return sum;
}

/**
 * Solve NPV(rate) = 0. Tries Newton-Raphson, falls back to bisection over a
 * wide bracket for robustness. Returns null when no sign change exists (e.g.
 * a position that only ever lost money to total wipeout).
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const t0 = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0].date);

  // Newton-Raphson
  let rate = 0.1;
  for (let i = 0; i < 50; i++) {
    const f = npv(rate, flows, t0);
    const h = 1e-6;
    const d = (npv(rate + h, flows, t0) - f) / h;
    if (Math.abs(d) < 1e-12) break;
    const next = rate - f / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-8) return clamp(next);
    rate = next;
  }

  // Bisection fallback
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo, flows, t0);
  let fhi = npv(hi, flows, t0);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid, flows, t0);
    if (Math.abs(fmid) < 1e-7) return clamp(mid);
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return clamp((lo + hi) / 2);
}

function clamp(rate: number): number {
  return Math.max(-0.9999, Math.min(rate, 100));
}

/**
 * Build cashflows from a transaction log plus the current market value, then
 * compute the position's money-weighted annual return.
 */
export function positionIRR(
  txs: Transaction[],
  currentValue: number,
): number | null {
  const flows: CashFlow[] = txs.map((t) => ({
    date: t.date,
    amount:
      t.type === "BUY"
        ? -(t.quantity * t.price + t.fee + t.tax)
        : t.type === "SELL"
          ? t.quantity * t.price - t.fee - t.tax
          : 0, // BOOKING: nothing paid in (free crediting)
  }));
  if (currentValue > 0) flows.push({ amount: currentValue, date: today() });
  return xirr(flows);
}

/**
 * Money-weighted IRR for the whole portfolio. `flows` are external cash flows
 * in the base currency from the investor's perspective (buys negative, sells
 * positive); the current total market value is added as the final inflow.
 */
export function portfolioIRR(flows: CashFlow[], marketValue: number): number | null {
  if (marketValue <= 0 || flows.length === 0) return null;
  return xirr([...flows, { amount: marketValue, date: today() }]);
}
