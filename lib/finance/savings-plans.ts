// Savings-plan occurrence math — pure, no React, no store access. A plan's
// schedule is derived entirely from (startDate, interval, lastRunDate):
// nothing is precomputed or stored, mirroring how holdings replay the
// transaction log.

import type { Asset, SavingsPlan, SavingsPlanInterval } from "../types";
import type { ValuationContext } from "./portfolio";
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

/** Multiplier that normalizes one execution's amount to a monthly equivalent. */
const MONTHLY_FACTOR: Record<SavingsPlanInterval, number> = {
  WEEKLY: 52 / 12,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
};

/** Native-currency → base-currency spot rate for an asset (mirrors the
 *  `rateOf` helper duplicated across lib/finance modules — this module stays
 *  free of a runtime dependency on the finance core beyond the type). */
function rateOf(asset: Asset, v?: ValuationContext): number {
  const cur = asset.currency ?? v?.base ?? "";
  if (!v || !cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

/**
 * Sum of ACTIVE plans' amounts, each normalized to a monthly equivalent
 * (WEEKLY = amount*52/12, MONTHLY = amount, QUARTERLY = amount/3) and
 * converted from the plan's asset currency to the base currency. Plans whose
 * asset no longer exists, or that are paused, are skipped. Omitting the
 * valuation context values everything 1:1 (native currency), matching the
 * rest of the finance core's currency-agnostic default.
 */
export function monthlyContributionOf(
  plans: SavingsPlan[],
  assets: Asset[],
  v?: ValuationContext,
): number {
  const byId = new Map(assets.map((a) => [a.id, a]));
  let total = 0;
  for (const plan of plans) {
    if (!plan.active) continue;
    const asset = byId.get(plan.assetId);
    if (!asset) continue;
    total += plan.amount * MONTHLY_FACTOR[plan.interval] * rateOf(asset, v);
  }
  return total;
}
