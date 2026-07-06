// Savings-plan occurrence math — pure, no React, no store access. A plan's
// schedule is derived entirely from (startDate, interval, lastRunDate):
// nothing is precomputed or stored, mirroring how holdings replay the
// transaction log.

import type { SavingsPlan } from "../types";
import { addDays } from "./dates";

/** Hard cap on materialized occurrences per plan per review, so a plan created
 *  years in the past can't explode into thousands of rows in one dialog. */
export const MAX_DUE_OCCURRENCES = 60;

/** Clamp a (year, month0, day) to the month's real length → YYYY-MM-DD. */
function ymd(year: number, month0: number, day: number): string {
  // Day 0 of month+1 = last day of month (UTC-stable).
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(year, month0, Math.min(day, lastDay)));
  return d.toISOString().slice(0, 10);
}

/**
 * The k-th occurrence of a plan (k = 0 is the start date itself). Monthly and
 * quarterly plans keep the start's day-of-month, clamping to shorter months
 * (start Jan 31 → Feb 28/29 → Mar 31, like brokers execute Sparpläne).
 */
export function occurrenceAt(plan: Pick<SavingsPlan, "startDate" | "interval">, k: number): string {
  if (plan.interval === "WEEKLY") return addDays(plan.startDate, 7 * k);
  const [y, m, d] = plan.startDate.split("-").map(Number);
  const months = plan.interval === "MONTHLY" ? k : 3 * k;
  return ymd(y, m - 1 + months, d);
}

/**
 * All occurrences due for materialization: strictly after `lastRunDate` (or
 * from `startDate` when the plan never ran), up to and including `today`.
 * Paused plans are never due. Capped at MAX_DUE_OCCURRENCES.
 */
export function dueOccurrences(plan: SavingsPlan, today: string): string[] {
  if (!plan.active) return [];
  const out: string[] = [];
  for (let k = 0; out.length < MAX_DUE_OCCURRENCES; k++) {
    const date = occurrenceAt(plan, k);
    if (date > today) break;
    if (plan.lastRunDate && date <= plan.lastRunDate) continue;
    out.push(date);
  }
  return out;
}

/** The next scheduled occurrence strictly after `today` / the last run. */
export function nextOccurrence(plan: SavingsPlan, today: string): string {
  const floor = plan.lastRunDate && plan.lastRunDate > today ? plan.lastRunDate : today;
  for (let k = 0; ; k++) {
    const date = occurrenceAt(plan, k);
    if (date > floor) return date;
  }
}
