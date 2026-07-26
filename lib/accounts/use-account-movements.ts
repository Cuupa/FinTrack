"use client";

// The one place the React tree derives account movements from the spending
// ledger, so every surface that shows a balance shows the SAME number.
//
// `lib/finance/account-ledger.ts` is pure and knows nothing about React; this
// hook is the thin memoised adapter over `usePortfolio()`, mirroring how
// `TagsProvider` adapts the store's tag data. Balance surfaces (dashboard hero,
// area cards, /accounts, /debt, /fire, /health, /goals, the AI context) all
// read it and pass it into the finance functions — a surface that forgot to
// would quietly render pre-ledger numbers next to post-ledger ones.

import { useMemo } from "react";

import { accountMovements, type AccountMovements } from "@/lib/finance/account-ledger";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";

/**
 * Every movement the user's spending ledger implies, grouped by account.
 *
 * Deliberately NOT gated on the `spending` feature flag: a contract booking is
 * a `SpendingTransaction` too, so gating here would make a loan instalment stop
 * retiring its debt the moment the spending surface is switched off. With no
 * bookings the map is empty and every balance falls back to the plain reading
 * series, which is exactly the old behaviour.
 */
export function useAccountMovements(): AccountMovements {
  const { data } = usePortfolio();
  return useMemo(
    () => accountMovements(data.spendingTransactions, data.accounts),
    [data.spendingTransactions, data.accounts],
  );
}
