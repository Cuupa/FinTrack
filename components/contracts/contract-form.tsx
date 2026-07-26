"use client";

// One contract form, used by both the "add" card and the edit dialog on
// /contracts — the same split `GoalForm` (components/goals/goals-view.tsx)
// uses, and for the same reason: a contract that can only ever be created is
// a dead entry. Everything the contract can express is editable afterwards,
// including the three fields that decide whether it books at all (account,
// target account, start date).
//
// The form owns only its own draft state. Persisting is the caller's job
// (`addContract` / `updateContract`), so this component stays usable from the
// card and the dialog without knowing which one it is in.

import { useState } from "react";

import { CONTRACT_INTERVALS, INSURANCE_TYPES } from "@/lib/types";
import type {
  Account,
  Contract,
  ContractInterval,
  InsuranceType,
  SpendingCategory,
} from "@/lib/types";
import type { ContractInput } from "@/lib/store/types";
import { today } from "@/lib/finance/dates";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, SegmentedControl } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900";

export interface ContractFormProps {
  accounts: Account[];
  categories: SpendingCategory[];
  /** Profile base currency — contract amounts are stored in it. */
  base: string;
  insuranceEnabled: boolean;
  /** The contract being edited, or null/undefined when adding a new one. */
  initial?: Contract | null;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (input: ContractInput) => void | Promise<void>;
  /** Rendered next to submit when present (the edit dialog's "cancel"). */
  onCancel?: () => void;
}

export function ContractForm({
  accounts,
  categories,
  base,
  insuranceEnabled,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: ContractFormProps) {
  const { t } = useI18n();

  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [interval, setInterval] = useState<ContractInterval>(initial?.interval ?? "MONTHLY");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [renewalDate, setRenewalDate] = useState(initial?.renewalDate ?? "");
  const [noticeDays, setNoticeDays] = useState(
    initial?.cancellationNoticeDays != null ? String(initial.cancellationNoticeDays) : "",
  );
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [targetAccountId, setTargetAccountId] = useState(initial?.targetAccountId ?? "");
  // Defaults to today for a NEW contract (nobody wants a fresh entry to post
  // two years of back charges by accident), but it is a real field: typing an
  // earlier date is exactly how you say "this has been running since March",
  // and the due-review dialog then offers those charges for catching up.
  const [bookingStartDate, setBookingStartDate] = useState(initial?.bookingStartDate ?? today());
  const [isInsurance, setIsInsurance] = useState(Boolean(initial?.insuranceType));
  const [insuranceType, setInsuranceType] = useState<InsuranceType | "">(
    initial?.insuranceType ?? "",
  );
  const [sumInsured, setSumInsured] = useState(
    initial?.sumInsured != null ? String(initial.sumInsured) : "",
  );

  const intervalLabel = (i: ContractInterval) =>
    t(`contracts.interval.${i}` as Parameters<typeof t>[0]);
  const insuranceTypeLabel = (i: InsuranceType) =>
    t(`contracts.insuranceType.${i}` as Parameters<typeof t>[0]);

  function buildInput(): ContractInput | null {
    const trimmed = name.trim();
    const value = parseDecimal(amount);
    if (!trimmed || !Number.isFinite(value) || value <= 0) return null;
    const notice = noticeDays.trim() ? Number.parseInt(noticeDays, 10) : null;
    const sumInsuredVal = sumInsured.trim() ? parseDecimal(sumInsured) : null;
    return {
      name: trimmed,
      amount: value,
      interval,
      renewalDate: renewalDate || null,
      cancellationNoticeDays: notice !== null && Number.isFinite(notice) ? notice : null,
      categoryId: categoryId || null,
      accountId: accountId || null,
      targetAccountId: (accountId && targetAccountId) || null,
      bookingStartDate: accountId ? bookingStartDate || today() : null,
      // Editing keeps whatever has already been posted: resetting this would
      // offer every charge since the start date a second time.
      lastBookedDate: initial?.lastBookedDate ?? null,
      // The kind toggle is authoritative: an ordinary contract never carries an
      // insurance type or a sum insured, whatever the fields last held.
      insuranceType: isInsurance ? insuranceType || null : null,
      sumInsured:
        isInsurance && sumInsuredVal != null && Number.isFinite(sumInsuredVal)
          ? sumInsuredVal
          : null,
    };
  }

  function handleSubmit() {
    const input = buildInput();
    if (!input) return;
    void onSubmit(input);
  }

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className="text-sm font-medium" htmlFor="contract-name">
          {t("contracts.form.nameLabel")}
        </label>
        <input
          id="contract-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("contracts.form.namePlaceholder")}
          className={inputCls}
          data-private
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="contract-amount">
          {t("contracts.form.amountLabel", { currency: base })}
        </label>
        <input
          id="contract-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
          placeholder="0"
          className={inputCls}
          data-private
        />
      </div>
      <div>
        <label className="text-sm font-medium">{t("contracts.form.intervalLabel")}</label>
        <SelectMenu
          className="mt-1 w-full"
          ariaLabel={t("contracts.form.intervalLabel")}
          value={interval}
          onChange={(v) => setInterval(v as ContractInterval)}
          options={CONTRACT_INTERVALS.map((i) => ({ value: i, label: intervalLabel(i) }))}
        />
      </div>
      {/* Choosing an account is what turns a register entry into something
          that actually posts the charge. Left empty (the default, and how
          every contract behaved before booking existed) it stays a note. */}
      <div data-tour="contract-account">
        <label className="text-sm font-medium">{t("contracts.form.accountLabel")}</label>
        <SelectMenu
          className="mt-1 w-full"
          ariaLabel={t("contracts.form.accountLabel")}
          value={accountId}
          onChange={setAccountId}
          options={[
            { value: "", label: t("contracts.form.accountNone") },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <p className="mt-1 text-sm text-zinc-500">
          {accountId ? t("contracts.form.accountHintOn") : t("contracts.form.accountHintOff")}
        </p>
      </div>
      {/* Since when the contract has been running. Only asked once it books,
          because without an account there is nothing to book from. */}
      {accountId && (
        <div>
          <label className="text-sm font-medium" htmlFor="contract-start">
            {t("contracts.form.startLabel")}
          </label>
          <input
            id="contract-start"
            type="date"
            value={bookingStartDate}
            onChange={(e) => setBookingStartDate(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-sm text-zinc-500">{t("contracts.form.startHint")}</p>
        </div>
      )}
      {/* Only meaningful once the contract books: it says the money is not
          consumed but moved somewhere of yours — a loan being repaid, or a
          policy building value. Those bookings stay out of the income and
          expense figures, which is what stops a Riester premium reading as
          250 EUR spent every month. */}
      {accountId && (
        <div>
          <label className="text-sm font-medium">{t("contracts.form.targetLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("contracts.form.targetLabel")}
            value={targetAccountId}
            onChange={setTargetAccountId}
            options={[
              { value: "", label: t("contracts.form.targetNone") },
              ...accounts
                .filter((a) => a.id !== accountId)
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <p className="mt-1 text-sm text-zinc-500">
            {targetAccountId ? t("contracts.form.targetHintOn") : t("contracts.form.targetHintOff")}
          </p>
        </div>
      )}
      <div>
        <label className="text-sm font-medium">{t("contracts.form.categoryLabel")}</label>
        <SelectMenu
          className="mt-1 w-full"
          ariaLabel={t("contracts.form.categoryLabel")}
          value={categoryId}
          onChange={setCategoryId}
          searchable
          options={[
            { value: "", label: t("contracts.list.noCategory") },
            ...categories.map((c) => ({
              value: c.id,
              label: `${c.groupName} · ${c.name}`,
            })),
          ]}
        />
      </div>
      {/* Ask what KIND of commitment this is before asking anything about
          insurance, so a streaming subscription is never asked which
          insurance it is. */}
      {insuranceEnabled && (
        <div data-tour="contract-kind">
          <label className="text-sm font-medium">{t("contracts.form.kindLabel")}</label>
          <div className="mt-1">
            <SegmentedControl
              options={[
                { value: "contract", label: t("contracts.form.kindContract") },
                { value: "insurance", label: t("contracts.form.kindInsurance") },
              ]}
              value={isInsurance ? "insurance" : "contract"}
              onChange={(v) => {
                const next = v === "insurance";
                setIsInsurance(next);
                // Leaving insurance must not keep a stale type/sum behind on
                // a contract that is no longer one.
                if (!next) {
                  setInsuranceType("");
                  setSumInsured("");
                } else if (!insuranceType) {
                  setInsuranceType("other");
                }
              }}
            />
          </div>
        </div>
      )}
      {insuranceEnabled && isInsurance && (
        <div>
          <label className="text-sm font-medium">{t("contracts.form.insuranceTypeLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("contracts.form.insuranceTypeLabel")}
            value={insuranceType}
            onChange={(v) => setInsuranceType(v as InsuranceType | "")}
            options={INSURANCE_TYPES.map((i) => ({ value: i, label: insuranceTypeLabel(i) }))}
          />
        </div>
      )}
      {insuranceEnabled && isInsurance && insuranceType && (
        <div>
          <label className="text-sm font-medium" htmlFor="contract-sum-insured">
            {t("contracts.form.sumInsuredLabel", { currency: base })}
          </label>
          <input
            id="contract-sum-insured"
            inputMode="decimal"
            value={sumInsured}
            onChange={(e) => setSumInsured(stripLeadingZero(e.target.value))}
            placeholder="0"
            className={inputCls}
            data-private
          />
        </div>
      )}
      <div>
        <label className="text-sm font-medium" htmlFor="contract-renewal">
          {t("contracts.form.renewalLabel")}
        </label>
        <input
          id="contract-renewal"
          type="date"
          value={renewalDate}
          onChange={(e) => setRenewalDate(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="contract-notice">
          {t("contracts.form.noticeLabel")}
        </label>
        <input
          id="contract-notice"
          inputMode="numeric"
          value={noticeDays}
          onChange={(e) => setNoticeDays(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="0"
          className={inputCls}
        />
      </div>
      <div className="flex items-end gap-2">
        <Button
          variant="primary"
          disabled={busy || !name.trim() || !amount.trim()}
          onClick={handleSubmit}
        >
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
