"use client";

// Recurring-charge contract register (ROADMAP #5, flag `contracts`):
// subscriptions/insurance/rent tracked as named commitments, plus detected
// recurring-charge suggestions the user can accept into the register.
// Everything rides the store seam via usePortfolio(); no mode branching.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today, addDays } from "@/lib/finance/dates";
import { detectRecurringCandidates, type RecurringCandidate } from "@/lib/finance/recurring";
import { type Contract, type ContractInterval, type InsuranceType } from "@/lib/types";
import type { ContractInput } from "@/lib/store/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { pendingBookings } from "@/lib/finance/contract-bookings";
import { Button, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ContractForm } from "@/components/contracts/contract-form";
import { useI18n } from "@/lib/i18n/i18n-context";
import { TablePagination, usePagination } from "@/components/ui/table";
import { useFeature } from "@/lib/flags/flags-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";
import { reportError } from "@/lib/errors/report";

type SortKey = "name" | "interval" | "amount" | "renewalDate";

export function ContractsView() {
  const {
    data,
    addContract,
    deleteContract,
    updateContract,
    updateSpendingTransaction,
    addSpendingTransaction,
  } = usePortfolio();
  const { t } = useI18n();
  // The insurance FIELDS on the contract form stay hidden while the feature is
  // locked: letting the user type data a locked feature can't act on would be
  // worse than not offering it (`insuranceEnabled` = enabled AND unlocked).
  const insurance = useFeature("insurance");
  const insuranceEnabled = insurance.enabled && !insurance.locked;
  const base = data.profile.currency;

  const insuranceTypeLabel = (i: InsuranceType) =>
    t(`contracts.insuranceType.${i}` as Parameters<typeof t>[0]);

  const categoriesById = useMemo(
    () => new Map(data.spendingCategories.map((c) => [c.id, c])),
    [data.spendingCategories],
  );
  const categoryLabel = (id: string | null) => {
    const c = id ? categoriesById.get(id) : null;
    return c ? `${c.groupName} · ${c.name}` : t("contracts.list.noCategory");
  };
  const intervalLabel = (i: ContractInterval) =>
    t(`contracts.interval.${i}` as Parameters<typeof t>[0]);

  const [booking, setBooking] = useState(false);
  // Remounts the add form after a successful save: `ContractForm` seeds its
  // draft state from `initial` on mount, so bumping the key is how the card
  // clears itself without the form having to expose a reset.
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<Contract | null>(null);

  const due = useMemo(() => pendingBookings(data.contracts, today()), [data.contracts]);

  // Which due charges will actually be posted. A past-dated start date can put
  // a year of catch-up charges in this list, and not all of them are
  // necessarily real (the contract may have been paused, or already booked by
  // hand), so each row is individually deselectable instead of the list being
  // all-or-nothing. Everything starts selected: the common case is "yes, book
  // them", and the exceptions are the point of the checkboxes.
  const dueKey = (b: { contractId: string; date: string }) => `${b.contractId}|${b.date}`;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const selectedDue = due.filter((b) => !excluded.has(dueKey(b)));

  /**
   * Posts every due charge as a spending transaction and advances each
   * contract's `lastBookedDate` to its newest booked date.
   *
   * Transactions first, contract second: replaying a booking that already
   * exists would double-charge, whereas a failure between the two only leaves
   * the contract looking due again, which the next run resolves.
   */
  /**
   * A failed write must say WHY. The store surfaces the database's own
   * message (missing column, check constraint, RLS refusal); hiding it behind
   * "please try again" turns a fixable schema problem into a form that fails
   * forever in silence. Reported to the error log too, per the owner rule
   * that an error only visible in the browser does not exist.
   */
  function saveFailed(err: unknown, fallback: string): string {
    if (isStorageFullError(err)) return t("common.storageFull");
    const reason = storeErrorReason(err);
    if (reason) {
      reportError({ kind: "console", level: "error", message: `contracts: ${reason}` });
      return `${fallback} ${reason}`;
    }
    return fallback;
  }

  async function bookDue() {
    setBooking(true);
    setError(null);
    try {
      const newest = new Map<string, string>();
      for (const b of selectedDue) {
        await addSpendingTransaction({
          accountId: b.accountId,
          categoryId: b.categoryId,
          date: b.date,
          amount: b.amount,
          payee: b.contractName,
          note: null,
          recurringId: b.contractId,
          transferAccountId: b.transferAccountId,
        });
        const prev = newest.get(b.contractId);
        if (!prev || b.date > prev) newest.set(b.contractId, b.date);
      }
      for (const [contractId, lastBookedDate] of newest) {
        await updateContract(contractId, { lastBookedDate });
      }
    } catch (err) {
      setError(saveFailed(err, t("contracts.due.error")));
    } finally {
      setBooking(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "renewalDate",
    dir: "asc",
  });
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const candidates = useMemo(
    // Accounts are passed so a loan instalment is not offered as a contract:
    // it is a transfer against a liability, not a recurring expense.
    () => detectRecurringCandidates(data.spendingTransactions, data.accounts),
    [data.spendingTransactions, data.accounts],
  );
  const visibleCandidates = candidates.filter(
    (c) => !dismissed.has(`${c.payee}|${c.amount}`),
  );

  const rows = useMemo(() => {
    const todayIso = today();
    const withDeadline = data.contracts.map((c) => {
      const deadline =
        c.renewalDate && c.cancellationNoticeDays != null
          ? addDays(c.renewalDate, -c.cancellationNoticeDays)
          : null;
      const noticeOpen = deadline !== null && todayIso >= deadline && todayIso <= c.renewalDate!;
      return { contract: c, noticeOpen };
    });
    withDeadline.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.contract.name.localeCompare(y.contract.name);
      else if (sort.key === "interval") cmp = x.contract.interval.localeCompare(y.contract.interval);
      else if (sort.key === "amount") cmp = x.contract.amount - y.contract.amount;
      else cmp = (x.contract.renewalDate ?? "").localeCompare(y.contract.renewalDate ?? "");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return withDeadline;
  }, [data.contracts, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  async function submit(input: ContractInput) {
    setBusy(true);
    setError(null);
    try {
      await addContract(input);
      setFormKey((k) => k + 1);
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(input: ContractInput) {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await updateContract(editing.id, input);
      setEditing(null);
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    } finally {
      setBusy(false);
    }
  }

  async function acceptCandidate(c: RecurringCandidate) {
    try {
      const contract = await addContract({
        name: c.payee,
        amount: c.amount,
        interval: c.interval,
        renewalDate: null,
        cancellationNoticeDays: null,
        categoryId: c.categoryId,
        // A detected candidate already knows where it was charged and when it
        // last ran, so the accepted contract books from the NEXT occurrence
        // rather than landing in the register inert. Anchoring the start on
        // the cluster's first date keeps the schedule aligned with the real
        // charging day, and `lastBookedDate` on its last one means the charges
        // it was detected from are never offered a second time.
        accountId: c.accountId,
        targetAccountId: null,
        bookingStartDate: c.dates[0] ?? today(),
        lastBookedDate: c.dates[c.dates.length - 1] ?? null,
      });
      await Promise.all(
        c.transactionIds.map((id) => updateSpendingTransaction(id, { recurringId: contract.id })),
      );
      setDismissed((d) => new Set(d).add(`${c.payee}|${c.amount}`));
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    }
  }

  function dismissCandidate(c: RecurringCandidate) {
    setDismissed((d) => new Set(d).add(`${c.payee}|${c.amount}`));
  }

  const pager = usePagination(rows);

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="space-y-6">
      {/* Mount placement is the auto-start gate, same as the other page tours:
          this view only renders once the contracts surface is reachable. */}

      {/* Due bookings, reviewed before anything is written — the same rule the
          savings-plans card follows: never post money movements silently. */}
      {due.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("contracts.due.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("contracts.due.intro", { n: due.length })}
          </p>
          <ul className="mt-4 space-y-2">
            {due.map((b) => {
              const key = dueKey(b);
              const checked = !excluded.has(key);
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(key);
                          else next.delete(key);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                    />
                    <span className={checked ? "" : "text-zinc-400 line-through"}>
                      {b.contractName} <span className="text-zinc-500">{formatDate(b.date)}</span>
                    </span>
                  </label>
                  <span
                    className={`tabular-nums ${
                      checked ? "text-red-600 dark:text-red-400" : "text-zinc-400 line-through"
                    }`}
                    data-private
                  >
                    {formatCurrency(b.amount, base)}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button
            className="mt-4"
            variant="primary"
            disabled={booking || selectedDue.length === 0}
            onClick={bookDue}
          >
            {t("contracts.due.bookSelected", { n: selectedDue.length })}
          </Button>
        </Card>
      )}

      {visibleCandidates.length > 0 && (
        <Card data-tour="contract-suggestions">
          <h2 className="text-lg font-semibold">{t("contracts.suggestions.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("contracts.suggestions.intro")}</p>
          <ul className="mt-4 space-y-2">
            {visibleCandidates.map((c) => (
              <li
                key={`${c.payee}|${c.amount}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
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
                  <Button size="sm" variant="secondary" onClick={() => dismissCandidate(c)}>
                    {t("contracts.suggestions.dismiss")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">{t("contracts.form.title")}</h2>
        <ContractForm
          key={formKey}
          accounts={data.accounts}
          categories={data.spendingCategories}
          base={base}
          insuranceEnabled={insuranceEnabled}
          submitLabel={t("contracts.form.add")}
          busy={busy}
          onSubmit={submit}
        />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("contracts.list.title")}</h2>
        {data.contracts.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("contracts.list.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("name")}>
                    {t("contracts.list.name")}
                    {arrow("name")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("interval")}>
                    {t("contracts.list.interval")}
                    {arrow("interval")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("amount")}>
                    {t("contracts.list.amount")}
                    {arrow("amount")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("renewalDate")}>
                    {t("contracts.list.renewalDate")}
                    {arrow("renewalDate")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pager.rows.map(({ contract, noticeOpen }) => (
                  <tr
                    key={contract.id}
                    className={`border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40 ${
                      noticeOpen ? "bg-amber-50 dark:bg-amber-950/30" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium" data-private>
                      {contract.name}
                      <div className="text-xs font-normal text-zinc-500">
                        {categoryLabel(contract.categoryId)}
                        {insuranceEnabled && contract.insuranceType && (
                          <>
                            {" · "}
                            {insuranceTypeLabel(contract.insuranceType)}
                            {contract.sumInsured != null &&
                              ` (${formatCurrency(contract.sumInsured, base)})`}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{intervalLabel(contract.interval)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" data-private>
                      {formatCurrency(contract.amount, base)}
                    </td>
                    <td className="px-3 py-2">
                      {contract.renewalDate ? (
                        <span className={noticeOpen ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                          {formatDate(contract.renewalDate)}
                          {noticeOpen && ` · ${t("contracts.list.noticeOpen")}`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(contract)}>
                          {t("contracts.list.edit")}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(contract)}>
                          {t("contracts.list.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination pager={pager} />
          </div>
        )}
      </Card>

      {/* Editing reuses the very same form the add card renders, seeded from
          the contract — including the three fields that decide whether it
          books at all (account, target account, start date), which is the
          whole point: a contract you cannot change is a dead entry. */}
      {/* Wide enough for the form's three-column grid: at the default width the
          fields stacked into one narrow column and the category dropdown, whose
          options carry a "group · name" label, overflowed its own popover. */}
      <Modal open={editing !== null} onClose={() => setEditing(null)} maxWidthClass="max-w-5xl">
        {editing && (
          <Card>
            <h2 className="text-lg font-semibold">{t("contracts.edit.title")}</h2>
            {/* Keyed on the contract so opening another row re-seeds the fields. */}
            <ContractForm
              key={editing.id}
              accounts={data.accounts}
              categories={data.spendingCategories}
              base={base}
              insuranceEnabled={insuranceEnabled}
              initial={editing}
              submitLabel={t("contracts.edit.save")}
              busy={busy}
              onSubmit={saveEdit}
              onCancel={() => setEditing(null)}
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </Card>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("contracts.delete.title")}
        message={confirmDelete ? t("contracts.delete.message", { name: confirmDelete.name }) : undefined}
        confirmLabel={t("contracts.list.delete")}
        onConfirm={() => {
          if (confirmDelete) void deleteContract(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
