"use client";

// The entry form for a planned income or expense (`PlannedCashflow`, flag
// `plannedCashflow`): the salary, a bonus, a one-off cost. It rides the store
// seam via usePortfolio(); no mode branching. Amounts are entered in the
// ACCOUNT's currency, like the ledger rows next to it, never converted here.
//
// It is the edit form behind a recurring row on /recurring/[kind]/[id]. New
// entries are created by the "recurring" switch on the /spending entry mask,
// which is the one place a repeating payment is added.

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, SegmentedControl } from "@/components/ui/primitives";
import { FormActions } from "@/components/ui/form-actions";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { missingFieldCls, missingLabelCls, useFormTouched } from "@/lib/forms/required";
import { isStorageFullError } from "@/lib/store/errors";
import { PLANNED_INTERVALS, type PlannedCashflow, type PlannedInterval } from "@/lib/types";
import type { PlannedCashflowInput } from "@/lib/store/types";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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
  const [monthEnd, setMonthEnd] = useState(initial?.monthEnd ?? false);
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [transferAccountId, setTransferAccountId] = useState(initial?.transferAccountId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = data.accounts.find((a) => a.id === accountId)?.currency || base;
  const missingName = !name.trim();
  const missingAmount = !amount.trim();
  const canSubmit = !busy && accountId !== "" && !missingName && !missingAmount && startDate !== "";

  /** Month-end only has a meaning for the month-based cadences. */
  const monthEndApplies = interval !== "ONCE" && interval !== "WEEKLY";

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
        // Cleared for a cadence it cannot apply to, so switching to weekly
        // never leaves a hidden flag behind.
        monthEnd: monthEndApplies && monthEnd,
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
          {/* The same field the entry mask calls "payee" — it is filled from
              exactly that box when a booking is switched to recurring, so it
              must not be renamed on the way to the detail view. */}
          <label className="text-sm font-medium" htmlFor="planned-name">
            {t(isIncome ? "spending.form.payerLabel" : "spending.form.payeeLabel")}
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
          <label className="text-sm font-medium">{t("spending.form.typeLabel")}</label>
          {/* Expense/income is a SegmentedControl in the entry mask and in the
              edit dialog; a pair of buttons here made the same choice look
              like a different kind of control. */}
          <div className="mt-1">
            <SegmentedControl
              options={[
                { value: "expense", label: t("spending.form.type.expense") },
                { value: "income", label: t("spending.form.type.income") },
              ]}
              value={isIncome ? "income" : "expense"}
              onChange={(v) => setIsIncome(v === "income")}
            />
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
          {monthEndApplies && (
            <label className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
              <input
                type="checkbox"
                checked={monthEnd}
                onChange={(e) => setMonthEnd(e.target.checked)}
                className="h-4 w-4"
              />
              {t("recurring.monthEnd")}
            </label>
          )}
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
                label: c.name,
              group: c.groupName,
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
          <label className="text-sm font-medium">{t("spending.edit.transferLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.edit.transferLabel")}
            value={transferAccountId}
            onChange={setTransferAccountId}
            options={[
              { value: "", label: t("spending.edit.transferNone") },
              ...data.accounts
                .filter((a) => a.id !== accountId)
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <p className="mt-1 text-sm text-zinc-500">
            {transferAccountId
              ? t("spending.edit.transferHintOn")
              : t("spending.edit.transferHintOff")}
          </p>
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
      </div>
      <FormActions error={error}>
        {touched && (missingName || missingAmount) && (
          <p className="mr-auto text-sm text-amber-600 dark:text-amber-400">
            {t("form.missingFields")}
          </p>
        )}
        {onCancel && (
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t("spending.planned.cancel")}
          </Button>
        )}
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </FormActions>
    </div>
  );
}
