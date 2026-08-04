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

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { nowDateTimeLocal } from "@/lib/finance/dates";
import { nextBooking as nextContractBooking, pendingBookings } from "@/lib/finance/contract-bookings";
import { duePlannedBookings, nextPlannedOccurrence } from "@/lib/finance/planned";
import { detectRecurringCandidates, type RecurringCandidate } from "@/lib/finance/recurring";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { RecurringForm } from "@/components/spending/recurring-form";
import { PlannedForm } from "@/components/spending/planned-form";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProGate } from "@/components/billing/pro-teaser";
import {
  Table,
  TablePagination,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  usePagination,
} from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";
import { reportError } from "@/lib/errors/report";
import { useToast } from "@/lib/notifications/toast-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import {
  accountInterestAmount,
  dueAccountInterest,
  nextAccountInterestDate,
} from "@/lib/finance/account-interest";
import { DeleteAction, EditAction, PauseAction, RowActions } from "@/components/ui/row-actions";

type SortKey = "name" | "amount" | "target" | "interval" | "next";

/** Inline edit boxes in the due list: quiet until focused, so the review list
 *  still reads as a list and not as a form. */
const dueInputCls =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900";

/** One row of the merged list, whichever entity produced it. */
interface RecurringRow {
  id: string;
  kind: "contract" | "planned" | "interest";
  name: string;
  /** Signed: income positive. A contract is always money out. */
  amount: number;
  currency: string;
  intervalLabel: string;
  /** Next due date, or null when it never books (a register-only contract). */
  next: string | null;
  accountName: string | null;
  /** Paused rows accrue no occurrences; the list mutes them and says so where
   *  the next date would be. */
  active: boolean;
  /**
   * Where the money ends up: the name of the user's own account it is moved
   * to, or null when it is simply consumed (an expense) or credited (income).
   *
   * The list showed the account a charge is booked FROM but never this, so a
   * loan instalment that retires a debt and a subscription that is gone for
   * good read identically -- the one question the overview could not answer.
   */
  targetName: string | null;
}

/** A due occurrence from either source, in the shape the review list needs. */
interface DueRow {
  key: string;
  sourceId: string;
  kind: "contract" | "planned" | "interest";
  name: string;
  date: string;
  amount: number;
  accountId: string;
  categoryId: string | null;
  transferAccountId: string | null;
  /** Positive magnitude of the interest share, 0 when the charge does not
   *  split. See `interestShare` in lib/finance/contract-bookings.ts. */
  interestAmount: number;
  interestAccountId: string | null;
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
  const { showToast } = useToast();
  // The flag decides visibility, the plan decides unlocked: a locked entry
  // surface stays on screen behind a teaser rather than vanishing.
  const contracts = useFeature("contracts");
  const base = data.profile.currency;
  const todayIso = today();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<RecurringRow | null>(null);
  const [editingRow, setEditingRow] = useState<RecurringRow | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  // A due occurrence is a PROPOSAL, not a receipt: the rate rose, the salary
  // carried a bonus, the charge landed two days late. Date and amount are
  // therefore editable per row before anything is posted, keyed by occurrence.
  const [edits, setEdits] = useState<Record<string, { date?: string; amount?: string }>>({});
  const [editingAmounts, setEditingAmounts] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const sort = useSort<SortKey>("next");

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
        active: c.active !== false,
        accountName: c.accountId ? (accountsById.get(c.accountId)?.name ?? null) : null,
        targetName: c.targetAccountId
          ? (accountsById.get(c.targetAccountId)?.name ?? null)
          : null,
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
        active: p.active !== false,
        accountName: accountsById.get(p.accountId)?.name ?? null,
        targetName: p.transferAccountId
          ? (accountsById.get(p.transferAccountId)?.name ?? null)
          : null,
      });
    }
    for (const account of data.accounts) {
      if (!account.interestRate || account.interestRate <= 0) continue;
      const next = nextAccountInterestDate(account, data.spendingTransactions, todayIso);
      out.push({
        id: account.id,
        kind: "interest",
        name: t("recurring.interestName", { name: account.name }),
        amount: accountInterestAmount(account, next ?? todayIso, data.accountBalances, movements),
        currency: account.currency || base,
        intervalLabel: intervalLabel(account.interestFrequency ?? "MONTHLY"),
        next,
        active: true,
        accountName: account.name,
        targetName: null,
      });
    }
    // A never-due row has `next === null`, and sortRows files missing values
    // last in BOTH directions -- "no next date" is not a date, and floating
    // those to the top would bury the actionable rows.
    return sort.apply(out, (r, key) => {
      if (key === "name") return r.name;
      if (key === "amount") return r.amount;
      if (key === "interval") return r.intervalLabel;
      // Sorted by the words actually on screen, so the transfers group
      // together and the consumed ones sit apart from them.
      if (key === "target") {
        return (
          r.targetName ??
          t(r.amount < 0 ? "recurring.target.consumed" : "recurring.target.credited")
        );
      }
      return r.next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.contracts, data.plannedCashflows, data.accounts, data.accountBalances, data.spendingTransactions, accountsById, base, sort, todayIso, t, movements]);

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
        interestAccountId: null,
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
        interestAccountId: null,
      });
    }
    for (const account of data.accounts) {
      for (const b of dueAccountInterest(account, data.spendingTransactions, data.accountBalances, movements, todayIso)) {
        out.push({
          key: `i|${b.accountId}|${b.date}`,
          sourceId: b.accountId,
          kind: "interest",
          name: t("recurring.interestName", { name: account.name }),
          date: b.date,
          amount: b.amount,
          accountId: b.accountId,
          categoryId: null,
          transferAccountId: null,
          interestAmount: 0,
          interestAccountId: b.accountId,
        });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [data.contracts, data.plannedCashflows, data.accounts, data.accountBalances, data.spendingTransactions, movements, todayIso, t]);

  const selected = due.filter((d) => !excluded.has(d.key));

  /** The date the row will post on: the occurrence's own day unless edited. */
  const dueDateOf = (d: DueRow) => edits[d.key]?.date ?? d.date;
  /** Always the magnitude — the sign belongs to the entry, not to this box. */
  const dueAmountText = (d: DueRow) => edits[d.key]?.amount ?? String(Math.abs(d.amount));
  const dueAmountOf = (d: DueRow) => {
    const value = parseDecimal(dueAmountText(d));
    if (!Number.isFinite(value) || value <= 0) return null;
    return d.amount < 0 ? -value : value;
  };
  const editRow = (key: string, patch: { date?: string; amount?: string }) =>
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  // Booking with a typo'd amount would post a row that has to be corrected
  // afterwards, so an invalid edit blocks the whole run rather than reverting
  // silently to the planned figure.
  const editsValid = selected.every((d) => dueAmountOf(d) !== null && dueDateOf(d));

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

  /** Pause/resume. Same act on both entities, so the row does not have to say
   *  which table it came from -- the whole point of merging the two lists. */
  async function togglePaused(row: RecurringRow) {
    setError(null);
    try {
      if (row.kind === "contract") await updateContract(row.id, { active: !row.active });
      else await updatePlannedCashflow(row.id, { active: !row.active });
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

  async function saveEditedRow(row: RecurringRow, input: Parameters<typeof updateContract>[1]) {
    setEditingBusy(true);
    setError(null);
    try {
      await updateContract(row.id, input);
      setEditingRow(null);
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    } finally {
      setEditingBusy(false);
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
        const amount = dueAmountOf(d);
        if (amount === null) continue;
        // The row posts on the edited day, but the source's cursor always
        // advances by the OCCURRENCE's own date: booking the first of the month
        // with today's date must not swallow the days in between.
        const date = dueDateOf(d);
        if (d.kind === "interest") {
          await addSpendingTransaction({
            accountId: d.accountId,
            categoryId: null,
            date,
            bookedAt: `${date}T${nowDateTimeLocal().slice(11)}`,
            amount,
            payee: d.name,
            note: null,
            recurringId: null,
            plannedId: null,
            transferAccountId: null,
            interestAccountId: d.interestAccountId,
          });
          continue;
        }
        // A loan instalment posts as TWO rows: the interest is consumed and
        // must reach the expense figures, the principal is a transfer that
        // shrinks the debt. One row could only ever be one of the two.
        const interest = Math.min(d.interestAmount, Math.abs(amount));
        if (interest > 0 && interest < Math.abs(amount)) {
          await addSpendingTransaction({
            accountId: d.accountId,
            categoryId: d.categoryId,
            date,
            bookedAt: `${date}T${nowDateTimeLocal().slice(11)}`,
            amount: -interest,
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
            date,
            bookedAt: `${date}T${nowDateTimeLocal().slice(11)}`,
            amount: amount + interest, // both negative: the remainder
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
          date,
          bookedAt: `${date}T${nowDateTimeLocal().slice(11)}`,
          amount,
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
      setEdits({});
      setEditingAmounts(new Set());
      showToast(t("spending.form.saved"));
    } catch (err) {
      setError(saveFailed(err, t("recurring.bookError")));
    } finally {
      setBusy(false);
    }
  }

  const pager = usePagination(rows);

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
                  className="grid min-w-0 gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center dark:hover:bg-zinc-800/40"
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
        <div className="mt-4">
          <Table>
            <Thead>
              <Th sort={sort.sort} sortKey="name" onSort={sort.toggle}>
                {t("recurring.col.name")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="amount" onSort={sort.toggle}>
                {t("recurring.col.amount")}
              </Th>
              <Th sort={sort.sort} sortKey="target" onSort={sort.toggle}>
                {t("recurring.col.target")}
              </Th>
              <Th sort={sort.sort} sortKey="interval" onSort={sort.toggle}>
                {t("recurring.col.interval")}
              </Th>
              <Th sort={sort.sort} sortKey="next" onSort={sort.toggle}>
                {t("recurring.col.next")}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {pager.rows.map((r) => (
                <Tr key={`${r.kind}:${r.id}`}>
                  <Td
                    className={`font-medium ${r.active ? "" : "text-zinc-400 dark:text-zinc-500"}`}
                    data-private
                  >
                    {/* Click through to the entry's own page: what it is plus
                        every booking it has produced. */}
                    {r.kind === "interest" ? (
                      <span>{r.name}</span>
                    ) : (
                      <Link href={`/recurring/${r.kind}/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    )}
                    {r.accountName && (
                      <div className="text-xs font-normal text-zinc-500">{r.accountName}</div>
                    )}
                  </Td>
                  <Td
                    align="right"
                    className={`tabular-nums ${
                      r.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                    }`}
                    data-private
                  >
                    {formatCurrency(r.amount, r.currency)}
                  </Td>
                  {/* Money moved to another of your own accounts keeps its
                      name; money that is gone says so. */}
                  <Td className="text-zinc-500" data-private={r.targetName ? true : undefined}>
                    {r.targetName ??
                      t(r.amount < 0 ? "recurring.target.consumed" : "recurring.target.credited")}
                  </Td>
                  <Td className="text-zinc-500">{r.intervalLabel}</Td>
                  <Td className="text-zinc-500">
                    {!r.active
                      ? t("sp.paused")
                      : r.next
                        ? formatDate(r.next)
                        : t("recurring.noNext")}
                  </Td>
                  <Td>
                    {r.kind !== "interest" && (
                      <RowActions>
                        <PauseAction
                          label={r.active ? t("sp.pause") : t("sp.resume")}
                          paused={!r.active}
                          onClick={() => void togglePaused(r)}
                        />
                        <EditAction
                          label={t("contracts.list.edit")}
                          onClick={() => setEditingRow(r)}
                        />
                        <DeleteAction
                          label={t("contracts.list.delete")}
                          onClick={() => setConfirmDelete(r)}
                        />
                      </RowActions>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
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
              const amount = dueAmountOf(d);
              const date = dueDateOf(d);
              const interest = amount === null ? 0 : Math.min(d.interestAmount, Math.abs(amount));
              const muted = checked ? "" : "text-zinc-400 line-through";
              return (
                <li
                  key={d.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                >
                  {/* The label covers the name only: a date or amount box inside
                      it would toggle the checkbox on every click. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
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
                      <span className={muted} data-private>
                        {d.name}
                        {/* Say up front that this posts two rows, so the ledger
                            does not surprise anyone afterwards. */}
                        {interest > 0 && amount !== null && Math.abs(amount) > interest && (
                          <span className="block text-xs text-zinc-500">
                            {t("recurring.split.hint", {
                              interest: formatCurrency(interest, currency),
                              principal: formatCurrency(Math.abs(amount) - interest, currency),
                            })}
                          </span>
                        )}
                      </span>
                    </label>
                    {/* Booking date is a deliberate per-occurrence choice. The
                        source cursor still advances by `d.date` in
                        `bookSelected`, whichever option is active here. */}
                    <div
                      role="group"
                      aria-label={t("recurring.due.dateLabel")}
                      className="inline-flex shrink-0 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700"
                    >
                      <button
                        type="button"
                        aria-pressed={date === d.date}
                        onClick={() => editRow(d.key, { date: d.date })}
                        className={`rounded px-2 py-1 text-xs tabular-nums transition-colors ${
                          date === d.date
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        }`}
                      >
                        {t("recurring.due.occurrence", { date: formatDate(d.date) })}
                      </button>
                      {d.date !== todayIso && (
                        <button
                          type="button"
                          aria-pressed={date === todayIso}
                          onClick={() => editRow(d.key, { date: todayIso })}
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            date === todayIso
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                          }`}
                        >
                          {t("recurring.due.today")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center justify-end gap-2 sm:justify-start">
                    {editingAmounts.has(d.key) ? (
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={dueAmountText(d)}
                        onChange={(e) => editRow(d.key, { amount: stripLeadingZero(e.target.value) })}
                        aria-label={t("recurring.due.amountLabel")}
                        className={`${dueInputCls} w-full min-w-0 text-right tabular-nums sm:w-28 ${
                          amount === null ? "border-red-500 dark:border-red-500" : ""
                        } ${
                          !checked
                            ? "text-zinc-400 line-through"
                            : d.amount < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                        data-private
                      />
                    ) : (
                      <span
                        className={`min-w-28 text-right tabular-nums ${
                          !checked
                            ? "text-zinc-400 line-through"
                            : d.amount < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                        data-private
                      >
                        {formatCurrency(amount ?? d.amount, currency)}
                      </span>
                    )}
                    {!editingAmounts.has(d.key) && (
                      <RowActions>
                        <EditAction
                          label={t("recurring.due.editAmount")}
                          onClick={() =>
                            setEditingAmounts((prev) => new Set(prev).add(d.key))
                          }
                        />
                      </RowActions>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            className="mt-4"
            variant="primary"
            disabled={busy || selected.length === 0 || !editsValid}
            onClick={() => void bookSelected()}
          >
            {t("recurring.due.book", { n: selected.length })}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {editingRow?.kind === "contract" && (
        <Modal open onClose={() => setEditingRow(null)} maxWidthClass="max-w-5xl">
          <Card>
            <h2 className="text-lg font-semibold">{t("contracts.edit.title")}</h2>
            <RecurringForm
              key={editingRow.id}
              accounts={data.accounts}
              categories={data.spendingCategories}
              base={base}
              insuranceEnabled={contracts.enabled && !contracts.locked}
              initial={data.contracts.find((c) => c.id === editingRow.id)}
              submitLabel={t("contracts.edit.save")}
              busy={editingBusy}
              onSubmit={(input) => void saveEditedRow(editingRow, input)}
              onCancel={() => setEditingRow(null)}
            />
          </Card>
        </Modal>
      )}

      {editingRow?.kind === "planned" && (
        <Modal open onClose={() => setEditingRow(null)} maxWidthClass="max-w-3xl">
          <Card>
            <h2 className="text-lg font-semibold">{t("spending.planned.editTitle")}</h2>
            <div className="mt-4">
              {(() => {
                const plan = data.plannedCashflows.find((p) => p.id === editingRow.id);
                return plan ? (
                  <PlannedForm
                    key={plan.id}
                    initial={plan}
                    submitLabel={t("spending.planned.save")}
                    onSubmit={async (input) => {
                      setEditingBusy(true);
                      setError(null);
                      try {
                        await updatePlannedCashflow(plan.id, input);
                        setEditingRow(null);
                      } catch (err) {
                        setError(saveFailed(err, t("spending.form.error")));
                      } finally {
                        setEditingBusy(false);
                      }
                    }}
                    onCancel={() => setEditingRow(null)}
                  />
                ) : null;
              })()}
            </div>
          </Card>
        </Modal>
      )}

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
