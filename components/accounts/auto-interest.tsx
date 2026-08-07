"use client";

// Books a liability's due interest by itself (owner rule: "da hab ich keine
// Möglichkeit die Zinsen wirklich zu kontrollieren").
//
// The card's review exists so the user can correct a figure before it lands.
// On a debt there is nothing to correct: the lender charges the interest
// whatever the app thinks, so a review would only be a button that has to be
// pressed for the ledger to stay true. Credit interest on an asset account
// still goes through the review — see `interestIsAutomatic`.
//
// Headless and mounted once in the provider tree, not on /spending: interest
// that only posts when the user happens to open the spending page is not
// automatic. Nothing renders, so the card that owns the reviewed interest is
// untouched.

import { useEffect, useRef } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { useFeatureFlags } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useToast } from "@/lib/notifications/toast-context";
import { today, nowDateTimeLocal } from "@/lib/finance/dates";
import { dueAccountInterest, interestIsAutomatic } from "@/lib/finance/account-interest";
import { reportError } from "@/lib/errors/report";
import { storeErrorReason } from "@/lib/store/errors";

export function AutoInterestBooker() {
  const { data, loading, addSpendingTransaction } = usePortfolio();
  const { isEnabled } = useFeatureFlags();
  const movements = useAccountMovements();
  const { t } = useI18n();
  const { showToast } = useToast();
  // One posting attempt per occurrence and mount. The booked row settles the
  // occurrence for good, but the write is in flight for a render or two and a
  // second pass over the same due date would post it twice.
  const attempted = useRef(new Set<string>());

  const enabled = isEnabled("accounts") && isEnabled("spending");

  useEffect(() => {
    if (loading || !enabled) return;
    const todayIso = today();
    const pending = data.accounts
      .filter(interestIsAutomatic)
      .flatMap((account) =>
        dueAccountInterest(
          account,
          data.spendingTransactions,
          data.accountBalances,
          movements,
          todayIso,
        ).map((due) => ({ due, name: account.name })),
      )
      .filter(({ due }) => !attempted.current.has(`${due.accountId}|${due.date}`));
    if (pending.length === 0) return;
    for (const { due } of pending) attempted.current.add(`${due.accountId}|${due.date}`);

    void (async () => {
      let booked = 0;
      for (const { due, name } of pending) {
        try {
          await addSpendingTransaction({
            accountId: due.accountId,
            categoryId: null,
            date: due.date,
            bookedAt: `${due.date}T${nowDateTimeLocal().slice(11)}`,
            amount: due.amount,
            payee: t("recurring.interestName", { name }),
            note: null,
            recurringId: null,
            plannedId: null,
            transferAccountId: null,
            interestAccountId: due.accountId,
          });
          booked += 1;
        } catch (err) {
          // A failed write must not disappear: the occurrence stays due and is
          // retried on the next load, but the reason belongs in the log.
          reportError({
            kind: "console",
            level: "error",
            message: `auto interest: ${storeErrorReason(err) ?? "booking failed"}`,
          });
        }
      }
      // Automatic is not secret: the user is told what landed, and the rows
      // themselves are on /spending.
      if (booked > 0) showToast(t("recurring.due.autoBooked", { n: booked }));
    })();
  }, [
    loading,
    enabled,
    data.accounts,
    data.accountBalances,
    data.spendingTransactions,
    movements,
    addSpendingTransaction,
    showToast,
    t,
  ]);

  return null;
}
