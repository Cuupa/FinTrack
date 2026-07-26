// Recurring-charge detection (ROADMAP item #5, flag `contracts`) — pure, no
// React, no lib/server imports. Clusters expense transactions by
// (payee, magnitude) and classifies the gap between occurrences into a
// `ContractInterval`, so the UI can suggest turning a repeating charge into a
// `Contract` register entry. Only expenses are considered: contracts (rent,
// subscriptions, insurance) are money going out, not income streams.

import type { Account, ContractInterval, SpendingTransaction } from "../types";
import { daysBetween } from "./dates";

export interface RecurringCandidate {
  payee: string;
  categoryId: string | null;
  /**
   * Account the detected series was charged against. Carried through so an
   * accepted candidate becomes a contract that actually books, instead of a
   * register entry the user has to re-point at an account by hand.
   */
  accountId: string;
  /** Typical (median) per-occurrence magnitude, positive, native currency. */
  amount: number;
  interval: ContractInterval;
  /** Ascending dates (YYYY-MM-DD) of the transactions that formed the cluster. */
  dates: string[];
  transactionIds: string[];
}

const AMOUNT_TOLERANCE = 0.05; // 5% relative tolerance for "same" recurring amount
const MIN_OCCURRENCES = 3;

interface IntervalBand {
  interval: ContractInterval;
  minDays: number;
  maxDays: number;
}

const BANDS: IntervalBand[] = [
  { interval: "MONTHLY", minDays: 25, maxDays: 35 },
  { interval: "QUARTERLY", minDays: 80, maxDays: 100 },
  { interval: "ANNUAL", minDays: 350, maxDays: 380 },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyInterval(gaps: number[]): ContractInterval | null {
  const gapMedian = median(gaps);
  for (const band of BANDS) {
    if (gapMedian >= band.minDays && gapMedian <= band.maxDays) return band.interval;
  }
  return null;
}

function normalizePayee(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Names of the user's liability accounts, for telling a loan instalment apart
 * from a contract.
 *
 * A contract is a recurring EXPENSE: the money is spent and net worth drops.
 * A loan instalment (an Annuitätendarlehen, say) is a TRANSFER: cash falls and
 * the debt falls with it, so net worth is unchanged at the moment of payment
 * and only the interest share is real expense. Suggesting one as a contract
 * would double-count it against the liability the user already tracks under
 * Accounts, and it belongs to a payoff goal instead.
 *
 * The available signal is the payee: the instalment is booked FROM the
 * checking account, so the liability appears only in who it went to. Matching
 * the transaction's own `accountId` would be wrong — a card purchase is booked
 * against a liability account and is still an ordinary expense.
 */
function liabilityPayees(accounts: Account[]): Set<string> {
  const names = new Set<string>();
  for (const a of accounts) {
    if (!a.isLiability) continue;
    const name = normalizePayee(a.name);
    if (name) names.add(name);
  }
  return names;
}

/**
 * Groups expense transactions by normalized payee + roughly-equal amount,
 * and returns clusters whose gaps between occurrences classify into a
 * regular monthly/quarterly/annual cadence. Transactions already linked to a
 * contract (`recurringId` set) or posted by a planned cashflow (`plannedId`
 * set) are excluded — they are already registered.
 *
 * Pass `accounts` to keep loan instalments out of the suggestions; see
 * {@link liabilityPayees} for why they are not contracts.
 */
export function detectRecurringCandidates(
  transactions: SpendingTransaction[],
  accounts: Account[] = [],
): RecurringCandidate[] {
  const expenses = transactions.filter(
    (t) => t.amount < 0 && t.recurringId === null && !t.plannedId,
  );
  const debtPayees = liabilityPayees(accounts);

  const byPayee = new Map<string, SpendingTransaction[]>();
  for (const t of expenses) {
    const key = normalizePayee(t.payee);
    if (!key || debtPayees.has(key)) continue;
    (byPayee.get(key) ?? byPayee.set(key, []).get(key)!).push(t);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [, txs] of byPayee) {
    // Sub-cluster by amount within tolerance, since one payee can carry
    // several unrelated charges (e.g. different subscription tiers).
    const remaining = [...txs].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    while (remaining.length > 0) {
      const anchor = Math.abs(remaining[0].amount);
      const cluster: SpendingTransaction[] = [];
      for (let i = remaining.length - 1; i >= 0; i--) {
        const magnitude = Math.abs(remaining[i].amount);
        if (Math.abs(magnitude - anchor) <= anchor * AMOUNT_TOLERANCE) {
          cluster.push(remaining[i]);
          remaining.splice(i, 1);
        }
      }
      if (cluster.length < MIN_OCCURRENCES) continue;

      cluster.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const gaps: number[] = [];
      for (let i = 1; i < cluster.length; i++) {
        gaps.push(daysBetween(cluster[i - 1].date, cluster[i].date));
      }
      const interval = classifyInterval(gaps);
      if (!interval) continue;

      candidates.push({
        payee: cluster[0].payee,
        categoryId: cluster[cluster.length - 1].categoryId,
        accountId: cluster[0].accountId,
        amount: median(cluster.map((t) => Math.abs(t.amount))),
        interval,
        dates: cluster.map((t) => t.date),
        transactionIds: cluster.map((t) => t.id),
      });
    }
  }

  return candidates.sort((a, b) => a.payee.localeCompare(b.payee));
}
