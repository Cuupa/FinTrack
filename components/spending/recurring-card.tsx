"use client";

// One list for everything that repeats (owner call: "ich will eine liste ...
// nix getrennt").
//
// Contracts and planned cashflows stay two entities in the store — a contract
// carries a renewal date, a cancellation notice and an insurance type, a plan
// carries a signed amount, ONCE/WEEKLY and an end date — but that distinction
// is the data model's business, not the user's. Whether the salary and the
// Netflix charge live in different tables is invisible here: both are "a named
// amount, on a rhythm, next due on X", and both are reviewed and booked
// through the same dialog.
//
// The split that used to be on screen (a contracts page plus a separate
// planned-entries card) meant the same question — what recurs? — had two
// answers in two places, neither of them complete. The contract register is
// gone entirely now (owner call): everything only it could do — adding an
// entry, the detected-charge suggestions, deleting one — happens here.

import { useMemo, useState } from "react";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { nextBooking as nextContractBooking, pendingBookings } from "@/lib/finance/contract-bookings";
import { duePlannedBookings, nextPlannedOccurrence } from "@/lib/finance/planned";
import { detectRecurringCandidates, type RecurringCandidate } from "@/lib/finance/recurring";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProGate } from "@/components/billing/pro-teaser";
import { TablePagination, usePagination } from "@/components/ui/table";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";
import { reportError } from "@/lib/errors/report";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { DeleteAction, EditAction, RowActions } from "@/components/ui/row-actions";

type SortKey = "name" | "amount" | "interval" | "next";

/** One row of the merged list, whichever entity produced it. */
interface RecurringRow {
  id: string;
  kind: "contract" | "planned";
  name: string;
  /** Signed: income positive. A contract is always money out. */
  amount: number;
  currency: string;
  intervalLabel: string;
  /** Next due date, or null when it never books (a register-only contract). */
  next: string | null;
  accountName: string | null;
}

/** A due occurrence from either source, in the shape the review list needs. */
interface DueRow {
  key: string;
  sourceId: string;
  kind: "contract" | "planned";
  name: string;
  date: string;
  amount: number;
  accountId: string;
  categoryId: string | null;
  transferAccountId: string | null;
  /** Positive magnitude of the interest share, 0 when the charge does not
   *  split. See `interestShare` in lib/finance/contract-bookings.ts. */
  interestAmount: number;
}

export function RecurringCard() {
  const {
    data,
    addSpendingTransaction,
    updateSpendingTransaction,
    addContract,
    updateContract,
    deleteContract,
    updatePlannedCashflow,
    deletePlannedCashflow,
  } = usePortfolio();
  const { t } = useI18n();
  const router = useRouter();
  // The flag decides visibility, the plan decides unlocked: a locked entry
  // surface stays on screen behind a teaser rather than vanishing.
  const contracts = useFeature("contracts");
  const base = data.profile.currency;
  const todayIso = today();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<RecurringRow | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "next",
    dir: "asc",
  });

  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );
  // Needed for the interest split: the debt outstanding on a booking date is
  // the carried-forward balance, not just the readings the user typed.
  const movements = useAccountMovements();

  const intervalLabel = (i: string) => t(`recurring.interval.${i}` as Parameters<typeof t>[0]);

  const rows = useMemo<RecurringRow[]>(() => {
    const out: RecurringRow[] = [];
    for (const c of data.contracts) {
      out.push({
        id: c.id,
        kind: "contract",
        name: c.name,
        // A contract is a commitment to PAY, so it always shows as money out
        // even though `Contract.amount` is stored unsigned.
        amount: -Math.abs(c.amount),
        currency: base,
        intervalLabel: intervalLabel(c.interval),
        next: nextContractBooking(c, todayIso),
        accountName: c.accountId ? (accountsById.get(c.accountId)?.name ?? null) : null,
      });
    }
    for (const p of data.plannedCashflows) {
      out.push({
        id: p.id,
        kind: "planned",
        name: p.name,
        amount: p.amount,
        currency: accountsById.get(p.accountId)?.currency || base,
        intervalLabel: intervalLabel(p.interval),
        next: nextPlannedOccurrence(p, todayIso),
        accountName: accountsById.get(p.accountId)?.name ?? null,
      });
    }
    out.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.name.localeCompare(y.name);
      else if (sort.key === "amount") cmp = x.amount - y.amount;
      else if (sort.key === "interval") cmp = x.intervalLabel.localeCompare(y.intervalLabel);
      else {
        // Never-due rows sort last in both directions: "no next date" is not a
        // date, and floating them to the top would bury the actionable rows.
        if (x.next === null && y.next === null) cmp = 0;
        else if (x.next === null) return 1;
        else if (y.next === null) return -1;
        else cmp = x.next.localeCompare(y.next);
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.contracts, data.plannedCashflows, accountsById, base, sort, todayIso, t]);

  const due = useMemo<DueRow[]>(() => {
    const out: DueRow[] = [];
    // Accounts + balances + movements are passed so a loan instalment can be
    // split into its interest and principal shares.
    for (const b of pendingBookings(
      data.contracts,
      todayIso,
      data.accounts,
      data.accountBalances,
      movements,
    )) {
      out.push({
        key: `c|${b.contractId}|${b.date}`,
        sourceId: b.contractId,
        kind: "contract",
        name: b.contractName,
        date: b.date,
        amount: b.amount,
        accountId: b.accountId,
        categoryId: b.categoryId,
        transferAccountId: b.transferAccountId,
        interestAmount: b.interestAmount,
      });
    }
    for (const b of duePlannedBookings(data.plannedCashflows, todayIso)) {
      out.push({
        key: `p|${b.plannedId}|${b.date}`,
        sourceId: b.plannedId,
        kind: "planned",
        name: b.name,
        date: b.date,
        amount: b.amount,
        accountId: b.accountId,
        categoryId: b.categoryId,
        transferAccountId: b.transferAccountId,
        // A plan carries no rate schedule of its own, so it never splits.
        interestAmount: 0,
      });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [data.contracts, data.plannedCashflows, data.accounts, data.accountBalances, movements, todayIso]);

  const selected = due.filter((d) => !excluded.has(d.key));

  function saveFailed(err: unknown, fallback: string): string {
    if (isStorageFullError(err)) return t("common.storageFull");
    const reason = storeErrorReason(err);
    if (reason) {
      reportError({ kind: "console", level: "error", message: `recurring: ${reason}` });
      return `${fallback} ${reason}`;
    }
    return fallback;
  }

  // Accounts are passed so a loan instalment is not offered as a recurring
  // expense: it is a transfer against a liability, not money consumed.
  const candidates = useMemo(
    () => detectRecurringCandidates(data.spendingTransactions, data.accounts),
    [data.spendingTransactions, data.accounts],
  );
  const candidateKey = (c: RecurringCandidate) => `${c.payee}|${c.amount}`;
  const visibleCandidates = candidates.filter((c) => !dismissed.has(candidateKey(c)));

  async function acceptCandidate(c: RecurringCandidate) {
    setError(null);
    try {
      const contract = await addContract({
        name: c.payee,
        amount: c.amount,
        interval: c.interval,
        renewalDate: null,
        cancellationNoticeDays: null,
        categoryId: c.categoryId,
        // A detected candidate already knows where it was charged and when it
        // last ran, so the accepted entry books from the NEXT occurrence
        // instead of landing inert. Anchoring the start on the cluster's first
        // date keeps the schedule on the real charging day, and
        // `lastBookedDate` on its last one means the charges it was detected
        // from are never offered a second time.
        accountId: c.accountId,
        targetAccountId: null,
        bookingStartDate: c.dates[0] ?? todayIso,
        lastBookedDate: c.dates[c.dates.length - 1] ?? null,
        insuranceType: null,
        sumInsured: null,
      });
      await Promise.all(
        c.transactionIds.map((id) => updateSpendingTransaction(id, { recurringId: contract.id })),
      );
      setDismissed((d) => new Set(d).add(candidateKey(c)));
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    }
  }

  async function removeRow(row: RecurringRow) {
    setError(null);
    try {
      if (row.kind === "contract") await deleteContract(row.id);
      else await deletePlannedCashflow(row.id);
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    }
  }

  /**
   * Posts the selected occurrences, then advances each source's
   * `lastBookedDate`. Transactions first, source second: replaying a booking
   * that already exists would double-charge, while a failure between the two
   * only leaves the row looking due again, which the next run resolves.
   */
  async function bookSelected() {
    setBusy(true);
    setError(null);
    try {
      const newestContract = new Map<string, string>();
      const newestPlanned = new Map<string, string>();
      for (const d of selected) {
        const recurringId = d.kind === "contract" ? d.sourceId : null;
        const plannedId = d.kind === "planned" ? d.sourceId : null;
        // A loan instalment posts as TWO rows: the interest is consumed and
        // must reach the expense figures, the principal is a transfer that
        // shrinks the debt. One row could only ever be one of the two.
        if (d.interestAmount > 0) {
          await addSpendingTransaction({
            accountId: d.accountId,
            categoryId: d.categoryId,
            date: d.date,
            amount: -d.interestAmount,
            payee: `${d.name} (${t("recurring.split.interest")})`,
            note: null,
            recurringId,
            plannedId,
            // No transfer: this money is gone, it does not land anywhere.
            transferAccountId: null,
          });
          await addSpendingTransaction({
            accountId: d.accountId,
            categoryId: d.categoryId,
            date: d.date,
            amount: d.amount + d.interestAmount, // both negative: the remainder
            payee: `${d.name} (${t("recurring.split.principal")})`,
            note: null,
            recurringId,
            plannedId,
            transferAccountId: d.transferAccountId,
          });
          const bucketSplit = d.kind === "contract" ? newestContract : newestPlanned;
          const prevSplit = bucketSplit.get(d.sourceId);
          if (!prevSplit || d.date > prevSplit) bucketSplit.set(d.sourceId, d.date);
          continue;
        }
        await addSpendingTransaction({
          accountId: d.accountId,
          categoryId: d.categoryId,
          date: d.date,
          amount: d.amount,
          payee: d.name,
          note: null,
          recurringId,
          plannedId,
          transferAccountId: d.transferAccountId,
        });
        const bucket = d.kind === "contract" ? newestContract : newestPlanned;
        const prev = bucket.get(d.sourceId);
        if (!prev || d.date > prev) bucket.set(d.sourceId, d.date);
      }
      for (const [id, lastBookedDate] of newestContract) {
        await updateContract(id, { lastBookedDate });
      }
      for (const [id, lastBookedDate] of newestPlanned) {
        await updatePlannedCashflow(id, { lastBookedDate });
      }
      setExcluded(new Set());
    } catch (err) {
      setError(saveFailed(err, t("recurring.bookError")));
    } finally {
      setBusy(false);
    }
  }

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  const pager = usePagination(rows);

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <Card data-tour="recurring-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("recurring.title")}</h2>
        {/* No "add" button here on purpose (owner rule): booking something and
            booking something that repeats are the SAME act, so the entry mask
            above owns it via its "recurring" switch. A button here was a second
            place to go, and the card's own empty state was already pointing at
            the switch. A row's renewal date, notice period and insurance fields
            are edited from the row itself. */}
      </div>

      {/* Charges that look recurring but are not tracked as such yet. Accepting
          one turns it into an entry and back-links the transactions it was
          detected from. */}
      {contracts.enabled && visibleCandidates.length > 0 && (
        <ProGate locked={contracts.locked} feature="contracts" className="mt-4">
          <div data-tour="recurring-suggestions" className="mt-4">
            <h3 className="text-sm font-semibold">{t("contracts.suggestions.title")}</h3>
            <p className="mt-1 text-sm text-zinc-500">{t("contracts.suggestions.intro")}</p>
            <ul className="mt-3 space-y-2">
              {visibleCandidates.map((c) => (
                <li
                  key={candidateKey(c)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                >
                  <span data-private>
                    <span className="font-medium">{c.payee}</span>{" "}
                    <span className="text-zinc-500">
                      · {formatCurrency(c.amount, base)} · {intervalLabel(c.interval)}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" onClick={() => void acceptCandidate(c)}>
                      {t("contracts.suggestions.accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDismissed((d) => new Set(d).add(candidateKey(c)))}
                    >
                      {t("contracts.suggestions.dismiss")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </ProGate>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("recurring.empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className={thCls} onClick={() => toggleSort("name")}>
                  {t("recurring.col.name")}
                  {arrow("name")}
                </th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort("amount")}>
                  {t("recurring.col.amount")}
                  {arrow("amount")}
                </th>
                <th className={thCls} onClick={() => toggleSort("interval")}>
                  {t("recurring.col.interval")}
                  {arrow("interval")}
                </th>
                <th className={thCls} onClick={() => toggleSort("next")}>
                  {t("recurring.col.next")}
                  {arrow("next")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {pager.rows.map((r) => (
                <tr
                  key={`${r.kind}:${r.id}`}
                  className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-3 py-2 font-medium" data-private>
                    {/* Click through to the entry's own page: what it is plus
                        every booking it has produced. */}
                    <Link href={`/recurring/${r.kind}/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                    {r.accountName && (
                      <div className="text-xs font-normal text-zinc-500">{r.accountName}</div>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                    }`}
                    data-private
                  >
                    {formatCurrency(r.amount, r.currency)}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{r.intervalLabel}</td>
                  <td className="px-3 py-2 text-zinc-500">
                    {r.next ? formatDate(r.next) : t("recurring.noNext")}
                  </td>
                  {/* Edit opens the row's own page straight in its editor, so
                      the change-scope question sits next to the bookings it
                      would rewrite instead of being asked twice in two places. */}
                  <td className="px-3 py-2">
                    <RowActions>
                      <EditAction
                        label={t("contracts.list.edit")}
                        onClick={() => router.push(`/recurring/${r.kind}/${r.id}?edit=1`)}
                      />
                      <DeleteAction
                        label={t("contracts.list.delete")}
                        onClick={() => setConfirmDelete(r)}
                      />
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination pager={pager} />
        </div>
      )}

      {/* Nothing is ever posted silently: due occurrences collect here and each
          one is deselectable, since a past-dated start can catch up a year of
          charges and not all of them are necessarily real. */}
      {due.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">{t("recurring.due.title", { n: due.length })}</h3>
          <ul className="mt-3 space-y-2">
            {due.map((d) => {
              const checked = !excluded.has(d.key);
              const currency = accountsById.get(d.accountId)?.currency || base;
              return (
                <li
                  key={d.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(d.key);
                          else next.delete(d.key);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                    />
                    <span className={checked ? "" : "text-zinc-400 line-through"} data-private>
                      {d.name} <span className="text-zinc-500">{formatDate(d.date)}</span>
                      {/* Say up front that this posts two rows, so the ledger
                          does not surprise anyone afterwards. */}
                      {d.interestAmount > 0 && (
                        <span className="block text-xs text-zinc-500">
                          {t("recurring.split.hint", {
                            interest: formatCurrency(d.interestAmount, currency),
                            principal: formatCurrency(
                              Math.abs(d.amount) - d.interestAmount,
                              currency,
                            ),
                          })}
                        </span>
                      )}
                    </span>
                  </label>
                  <span
                    className={`tabular-nums ${
                      !checked
                        ? "text-zinc-400 line-through"
                        : d.amount < 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                    }`}
                    data-private
                  >
                    {formatCurrency(d.amount, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button
            className="mt-4"
            variant="primary"
            disabled={busy || selected.length === 0}
            onClick={() => void bookSelected()}
          >
            {t("recurring.due.book", { n: selected.length })}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("contracts.delete.title")}
        message={
          confirmDelete ? t("contracts.delete.message", { name: confirmDelete.name }) : undefined
        }
        confirmLabel={t("contracts.list.delete")}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void removeRow(target);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}
