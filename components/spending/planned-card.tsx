"use client";

// Planned income & expenses (flag `plannedCashflow`): the salary, a bonus, a
// one-off cost. Everything rides the store seam via usePortfolio(); no mode
// branching. Amounts are entered and shown in the ACCOUNT's currency (like the
// ledger rows next to it), never converted here.
//
// Due occurrences are never posted silently: they collect until the user opens
// the review dialog, where each amount stays editable, because a salary is
// rarely exactly the planned figure. Same order as `ContractsView.bookDue`:
// transactions first, plan second.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { today } from "@/lib/finance/dates";
import {
  duePlannedBookings,
  monthlyEquivalent,
  nextPlannedOccurrence,
} from "@/lib/finance/planned";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { missingFieldCls, missingLabelCls, useFormTouched } from "@/lib/forms/required";
import { isStorageFullError } from "@/lib/store/errors";
import { PLANNED_INTERVALS, type PlannedCashflow, type PlannedInterval } from "@/lib/types";
import type { PlannedCashflowInput } from "@/lib/store/types";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "name" | "account" | "category" | "interval" | "next" | "amount" | "monthly";

/**
 * Self-gated like `BudgetsCard`: hidden when the flag is off, and — when the
 * flag is on but the feature requires Pro on a free plan — rendered blurred
 * behind the paywall instead of disappearing (MONETIZATION.md Phase 3).
 */
export function PlannedCard() {
  const { enabled, locked } = useFeature("plannedCashflow");
  if (!enabled) return null;
  if (locked)
    return (
      <ProTeaser feature="plannedCashflow">
        <PlannedCardInner />
      </ProTeaser>
    );
  return <PlannedCardInner />;
}

function PlannedCardInner() {
  const {
    data,
    addPlannedCashflow,
    updatePlannedCashflow,
    deletePlannedCashflow,
    addSpendingTransaction,
  } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;

  const accountsById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const categoriesById = useMemo(
    () => new Map(data.spendingCategories.map((c) => [c.id, c])),
    [data.spendingCategories],
  );

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "next",
    dir: "asc",
  });
  const [editing, setEditing] = useState<PlannedCashflow | null>(null);
  const [deleting, setDeleting] = useState<PlannedCashflow | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  /** Per-row amount overrides in the review dialog, keyed `plannedId|date`. */
  const [amountEdits, setAmountEdits] = useState<Record<string, string>>({});

  const now = today();
  const due = useMemo(
    () => duePlannedBookings(data.plannedCashflows, now),
    [data.plannedCashflows, now],
  );

  const intervalLabel = (i: PlannedInterval) =>
    t(`spending.planned.interval.${i}` as Parameters<typeof t>[0]);
  const categoryLabel = (id: string | null) => {
    const c = id ? categoriesById.get(id) : null;
    return c ? `${c.groupName} · ${c.name}` : t("spending.planned.categoryNone");
  };
  const currencyOf = (accountId: string) => accountsById.get(accountId)?.currency || base;

  const rows = useMemo(() => {
    const withDerived = data.plannedCashflows.map((p) => ({
      plan: p,
      next: nextPlannedOccurrence(p, now),
      monthly: monthlyEquivalent(p),
    }));
    withDerived.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.plan.name.localeCompare(y.plan.name);
      else if (sort.key === "account") {
        cmp = (accountsById.get(x.plan.accountId)?.name ?? "").localeCompare(
          accountsById.get(y.plan.accountId)?.name ?? "",
        );
      } else if (sort.key === "category") {
        cmp = categoryLabel(x.plan.categoryId).localeCompare(categoryLabel(y.plan.categoryId));
      } else if (sort.key === "interval") {
        cmp = intervalLabel(x.plan.interval).localeCompare(intervalLabel(y.plan.interval));
      } else if (sort.key === "next") {
        // A finished plan has no next date; it sorts last either way.
        cmp = (x.next ?? "9999-12-31").localeCompare(y.next ?? "9999-12-31");
      } else if (sort.key === "monthly") cmp = (x.monthly ?? 0) - (y.monthly ?? 0);
      else cmp = x.plan.amount - y.plan.amount;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return withDerived;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.plannedCashflows, sort, accountsById, categoriesById, now]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  /**
   * Posts every reviewed occurrence as a spending transaction and advances each
   * plan's `lastBookedDate` to its newest booked date.
   *
   * Transactions first, plan second: replaying a booking that already exists
   * would double-count, whereas a failure between the two only leaves the plan
   * looking due again, which the next run resolves.
   */
  async function bookDue() {
    setBooking(true);
    setBookError(null);
    try {
      const newest = new Map<string, string>();
      for (const b of due) {
        const override = parseDecimal(amountEdits[`${b.plannedId}|${b.date}`] ?? "");
        const magnitude =
          Number.isFinite(override) && override > 0 ? override : Math.abs(b.amount);
        await addSpendingTransaction({
          accountId: b.accountId,
          categoryId: b.categoryId,
          date: b.date,
          // The user types a magnitude; the plan's sign decides the direction,
          // so an edited salary can never flip into an expense by accident.
          amount: b.amount < 0 ? -magnitude : magnitude,
          payee: b.name,
          note: null,
          recurringId: null,
          transferAccountId: b.transferAccountId,
          plannedId: b.plannedId,
        });
        const prev = newest.get(b.plannedId);
        if (!prev || b.date > prev) newest.set(b.plannedId, b.date);
      }
      for (const [plannedId, lastBookedDate] of newest) {
        await updatePlannedCashflow(plannedId, { lastBookedDate });
      }
      setAmountEdits({});
      setReviewing(false);
    } catch (err) {
      setBookError(
        isStorageFullError(err) ? t("common.storageFull") : t("spending.planned.due.error"),
      );
    } finally {
      setBooking(false);
    }
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <Card data-tour="spending-planned">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("spending.planned.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("spending.planned.intro")}</p>
        </div>
        {due.length > 0 && (
          <Button variant="primary" size="sm" onClick={() => setReviewing(true)}>
            {t("spending.planned.due.button", { n: String(due.length) })}
          </Button>
        )}
      </div>

      {data.accounts.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("spending.planned.noAccounts")}</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">{t("spending.planned.empty")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className={thCls} onClick={() => toggleSort("name")}>
                      {t("spending.planned.col.name")}
                      {arrow("name")}
                    </th>
                    <th className={thCls} onClick={() => toggleSort("account")}>
                      {t("spending.planned.col.account")}
                      {arrow("account")}
                    </th>
                    <th className={thCls} onClick={() => toggleSort("category")}>
                      {t("spending.planned.col.category")}
                      {arrow("category")}
                    </th>
                    <th className={thCls} onClick={() => toggleSort("interval")}>
                      {t("spending.planned.col.interval")}
                      {arrow("interval")}
                    </th>
                    <th className={thCls} onClick={() => toggleSort("next")}>
                      {t("spending.planned.col.next")}
                      {arrow("next")}
                    </th>
                    <th className={`${thCls} text-right`} onClick={() => toggleSort("amount")}>
                      {t("spending.planned.col.amount")}
                      {arrow("amount")}
                    </th>
                    <th className={`${thCls} text-right`} onClick={() => toggleSort("monthly")}>
                      {t("spending.planned.col.monthly")}
                      {arrow("monthly")}
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ plan, next, monthly }) => {
                    const currency = currencyOf(plan.accountId);
                    return (
                      <tr
                        key={plan.id}
                        className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                      >
                        <td className="px-3 py-2 font-medium" data-private>
                          {plan.name}
                        </td>
                        <td className="px-3 py-2 text-zinc-500" data-private>
                          {accountsById.get(plan.accountId)?.name ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-zinc-500">
                          {categoryLabel(plan.categoryId)}
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{intervalLabel(plan.interval)}</td>
                        <td className="px-3 py-2 text-zinc-500">
                          {next ? formatDate(next) : t("spending.planned.finished")}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            plan.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                          }`}
                          data-private
                        >
                          {formatCurrency(plan.amount, currency)}
                        </td>
                        <td
                          className="px-3 py-2 text-right tabular-nums text-zinc-500"
                          data-private
                        >
                          {monthly === null ? "—" : formatCurrency(monthly, currency)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={() => setEditing(plan)}>
                              {t("spending.planned.edit")}
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setDeleting(plan)}>
                              {t("spending.planned.delete")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <PlannedForm
              key="add"
              submitLabel={t("spending.planned.add")}
              onSubmit={(input) => addPlannedCashflow(input)}
            />
          </div>
        </>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} maxWidthClass="max-w-2xl">
        <Card>
          <h2 className="text-lg font-semibold">{t("spending.planned.editTitle")}</h2>
          {editing && (
            <div className="mt-4">
              <PlannedForm
                key={editing.id}
                initial={editing}
                submitLabel={t("spending.planned.save")}
                onSubmit={async (input) => {
                  await updatePlannedCashflow(editing.id, input);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}
        </Card>
      </Modal>

      <Modal
        open={reviewing}
        onClose={() => {
          if (!booking) setReviewing(false);
        }}
        maxWidthClass="max-w-2xl"
      >
        <Card>
          <h2 className="text-lg font-semibold">{t("spending.planned.due.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("spending.planned.due.intro", { n: String(due.length) })}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {t("spending.planned.due.date")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {t("spending.planned.due.name")}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {t("spending.planned.due.account")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {t("spending.planned.due.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {due.map((b) => {
                  const key = `${b.plannedId}|${b.date}`;
                  const currency = currencyOf(b.accountId);
                  return (
                    <tr
                      key={key}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 text-zinc-500">{formatDate(b.date)}</td>
                      <td className="px-3 py-2 font-medium" data-private>
                        {b.name}
                      </td>
                      <td className="px-3 py-2 text-zinc-500" data-private>
                        {accountsById.get(b.accountId)?.name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          inputMode="decimal"
                          aria-label={`${t("spending.planned.due.amount")} ${currency}`}
                          value={amountEdits[key] ?? String(Math.abs(b.amount))}
                          onChange={(e) =>
                            setAmountEdits((m) => ({
                              ...m,
                              [key]: stripLeadingZero(e.target.value),
                            }))
                          }
                          className="w-28 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700"
                          data-private
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bookError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{bookError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={booking} onClick={() => setReviewing(false)}>
              {t("spending.planned.cancel")}
            </Button>
            <Button variant="primary" disabled={booking} onClick={() => void bookDue()}>
              {t("spending.planned.due.book")}
            </Button>
          </div>
        </Card>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={t("spending.planned.deleteTitle")}
        message={deleting ? t("spending.planned.deleteConfirm", { name: deleting.name }) : undefined}
        confirmLabel={t("spending.planned.delete")}
        onConfirm={() => {
          if (deleting) void deletePlannedCashflow(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}

/**
 * One form for both the add surface and the edit dialog (same precedent as
 * `GoalForm`), so correcting a planned entry means editing it, never
 * recreating it.
 */
/**
 * Add/edit form for a planned cashflow.
 *
 * Exported because the merged "Recurring" list and the per-entry detail page
 * both need it: when this card stopped being rendered on /spending, it took
 * the only way to create or edit a planned entry with it, so a salary could be
 * looked at but never changed.
 */
export function PlannedForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: PlannedCashflow;
  submitLabel: string;
  onSubmit: (input: PlannedCashflowInput) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const { data } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;
  const { touched, touch, reset } = useFormTouched();

  const [name, setName] = useState(initial?.name ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? data.accounts[0]?.id ?? "");
  const [isIncome, setIsIncome] = useState(initial ? initial.amount >= 0 : true);
  const [amount, setAmount] = useState(initial ? String(Math.abs(initial.amount)) : "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [interval, setInterval] = useState<PlannedInterval>(initial?.interval ?? "MONTHLY");
  const [startDate, setStartDate] = useState(initial?.startDate ?? today());
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [transferAccountId, setTransferAccountId] = useState(initial?.transferAccountId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = data.accounts.find((a) => a.id === accountId)?.currency || base;
  const missingName = !name.trim();
  const missingAmount = !amount.trim();
  const canSubmit = !busy && accountId !== "" && !missingName && !missingAmount && startDate !== "";

  async function submit() {
    const magnitude = parseDecimal(amount);
    if (!accountId || !name.trim() || !startDate) return;
    if (!Number.isFinite(magnitude) || magnitude <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        accountId,
        categoryId: categoryId || null,
        amount: isIncome ? magnitude : -magnitude,
        interval,
        startDate,
        endDate: endDate || null,
        // Editing keeps whatever has already been booked; a fresh plan starts
        // with a clean slate.
        lastBookedDate: initial?.lastBookedDate ?? null,
        transferAccountId: transferAccountId || null,
        note: note.trim() || null,
      });
      if (!initial) {
        setName("");
        setAmount("");
        setNote("");
        setEndDate("");
        reset();
      }
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("spending.planned.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="text-sm font-medium" htmlFor="planned-name">
            {t("spending.planned.nameLabel")}
          </label>
          <input
            id="planned-name"
            value={name}
            onChange={(e) => {
              touch();
              setName(e.target.value);
            }}
            placeholder={t("spending.planned.namePlaceholder")}
            className={inputCls + missingFieldCls(missingName, touched)}
            data-private
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("spending.planned.accountLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.planned.accountLabel")}
            value={accountId}
            onChange={setAccountId}
            options={data.accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("spending.planned.typeLabel")}</label>
          <div className="mt-1 flex gap-2">
            <Button
              type="button"
              variant={isIncome ? "primary" : "secondary"}
              onClick={() => setIsIncome(true)}
            >
              {t("spending.planned.type.income")}
            </Button>
            <Button
              type="button"
              variant={!isIncome ? "primary" : "secondary"}
              onClick={() => setIsIncome(false)}
            >
              {t("spending.planned.type.expense")}
            </Button>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="planned-amount">
            {t("spending.planned.amountLabel", { currency })}
          </label>
          <input
            id="planned-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              touch();
              setAmount(stripLeadingZero(e.target.value));
            }}
            placeholder="0"
            className={inputCls + missingFieldCls(missingAmount, touched)}
            data-private
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("spending.planned.intervalLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.planned.intervalLabel")}
            value={interval}
            onChange={(v) => setInterval(v as PlannedInterval)}
            options={PLANNED_INTERVALS.map((i) => ({
              value: i,
              label: t(`spending.planned.interval.${i}` as Parameters<typeof t>[0]),
            }))}
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("spending.planned.categoryLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.planned.categoryLabel")}
            value={categoryId}
            onChange={setCategoryId}
            searchable
            options={[
              { value: "", label: t("spending.planned.categoryNone") },
              ...data.spendingCategories.map((c) => ({
                value: c.id,
                label: `${c.groupName} · ${c.name}`,
              })),
            ]}
          />
        </div>
        <div>
          <label className={missingLabelCls(startDate === "", touched)} htmlFor="planned-start">
            {t("spending.planned.startLabel")}
          </label>
          <input
            id="planned-start"
            type="date"
            value={startDate}
            onChange={(e) => {
              touch();
              setStartDate(e.target.value);
            }}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="planned-end">
            {t("spending.planned.endLabel")}
          </label>
          <input
            id="planned-end"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("spending.planned.transferLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.planned.transferLabel")}
            value={transferAccountId}
            onChange={setTransferAccountId}
            options={[
              { value: "", label: t("spending.planned.transferNone") },
              ...data.accounts
                .filter((a) => a.id !== accountId)
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          {transferAccountId && (
            <p className="mt-1 text-xs text-zinc-500">{t("spending.planned.transferHint")}</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="text-sm font-medium" htmlFor="planned-note">
            {t("spending.planned.noteLabel")}
          </label>
          <input
            id="planned-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("spending.planned.notePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className={inputCls}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              {t("spending.planned.cancel")}
            </Button>
          )}
        </div>
      </div>
      {touched && (missingName || missingAmount) && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{t("form.missingFields")}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
