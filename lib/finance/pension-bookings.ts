// A retirement policy's premium as spending transactions -- pure, reusing
// `contract-bookings.ts`'s occurrence arithmetic since a premium is monthly by
// definition. This only says what is DUE; the review writes the rows.

import type { PensionContract } from "../types";
import { bookingOccurrenceAt, MAX_DUE_BOOKINGS } from "./contract-bookings";

/** Whether this policy debits an account at all. */
export function booksPremiums(
  contract: Pick<PensionContract, "accountId" | "bookingStartDate" | "monthlyContribution">,
): boolean {
  return Boolean(
    contract.accountId && contract.bookingStartDate && (contract.monthlyContribution ?? 0) > 0,
  );
}

/**
 * Every premium date due: strictly after `lastBookedDate` (or from
 * `bookingStartDate` when nothing has been booked yet), up to and including
 * `today`. Capped like a contract's, so a start date years back cannot dump a
 * decade of premiums into one review.
 */
export function duePremiums(contract: PensionContract, today: string): string[] {
  if (!booksPremiums(contract)) return [];
  const start = contract.bookingStartDate!;
  const out: string[] = [];
  for (let k = 0; out.length < MAX_DUE_BOOKINGS; k++) {
    const date = bookingOccurrenceAt(start, "MONTHLY", k);
    if (date > today) break;
    if (contract.lastBookedDate && date <= contract.lastBookedDate) continue;
    out.push(date);
  }
  return out;
}

/** The next premium at or after `today` that has not been booked, or null when
 *  the policy books nothing. Tells the user when the next debit lands. */
export function nextPremium(contract: PensionContract, today: string): string | null {
  if (!booksPremiums(contract)) return null;
  const start = contract.bookingStartDate!;
  const floor =
    contract.lastBookedDate && contract.lastBookedDate > today ? contract.lastBookedDate : today;
  for (let k = 0; k < 1000; k++) {
    const date = bookingOccurrenceAt(start, "MONTHLY", k);
    if (date >= floor && !(contract.lastBookedDate && date <= contract.lastBookedDate)) return date;
  }
  return null;
}

export interface PendingPremium {
  contractId: string;
  contractName: string;
  accountId: string;
  date: string;
  /** Signed for the spending ledger: the premium always leaves the account. */
  amount: number;
}

/** Every policy's due premiums, oldest first, in the shape the review shows. */
export function pendingPremiums(
  contracts: readonly PensionContract[],
  today: string,
): PendingPremium[] {
  const out: PendingPremium[] = [];
  for (const contract of contracts) {
    for (const date of duePremiums(contract, today)) {
      out.push({
        contractId: contract.id,
        contractName: contract.name,
        accountId: contract.accountId!,
        date,
        amount: -Math.abs(contract.monthlyContribution ?? 0),
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
