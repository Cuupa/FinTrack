"use client";

// Recurring-charge contract register (ROADMAP #5, flag `contracts`):
// subscriptions/insurance/rent tracked as named commitments, plus detected
// recurring-charge suggestions the user can accept into the register.
// Everything rides the store seam via usePortfolio(); no mode branching.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today, addDays } from "@/lib/finance/dates";
import { detectRecurringCandidates, type RecurringCandidate } from "@/lib/finance/recurring";
import { coverageGaps } from "@/lib/finance/insurance";
import {
  CONTRACT_INTERVALS,
  INSURANCE_TYPES,
  type Contract,
  type ContractInterval,
  type InsuranceType,
} from "@/lib/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { pendingBookings } from "@/lib/finance/contract-bookings";
import { Button, Card, SegmentedControl } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeature } from "@/lib/flags/flags-context";
import { ProGate } from "@/components/billing/pro-teaser";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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
  // The coverage-gaps card is the insurance feature's showcase surface, so it
  // renders blurred behind the paywall when Pro-locked; the insurance FIELDS
  // on the contract form stay hidden while locked, since letting the user
  // type data a locked feature can't act on would be worse than not offering
  // it (`insuranceEnabled` = enabled AND unlocked, below).
  const insurance = useFeature("insurance");
  const insuranceEnabled = insurance.enabled && !insurance.locked;
  const base = data.profile.currency;

  const insuranceTypeLabel = (i: InsuranceType) =>
    t(`contracts.insuranceType.${i}` as Parameters<typeof t>[0]);
  const gaps = useMemo(() => coverageGaps(data.contracts), [data.contracts]);

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

  // Add-contract form state.
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<ContractInterval>("MONTHLY");
  const [categoryId, setCategoryId] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [noticeDays, setNoticeDays] = useState("");
  const [insuranceType, setInsuranceType] = useState<InsuranceType | "">("");
  const [isInsurance, setIsInsurance] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [booking, setBooking] = useState(false);

  const due = useMemo(() => pendingBookings(data.contracts, today()), [data.contracts]);

  /**
   * Posts every due charge as a spending transaction and advances each
   * contract's `lastBookedDate` to its newest booked date.
   *
   * Transactions first, contract second: replaying a booking that already
   * exists would double-charge, whereas a failure between the two only leaves
   * the contract looking due again, which the next run resolves.
   */
  async function bookDue() {
    setBooking(true);
    setError(null);
    try {
      const newest = new Map<string, string>();
      for (const b of due) {
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
      setError(isStorageFullError(err) ? t("common.storageFull") : t("contracts.due.error"));
    } finally {
      setBooking(false);
    }
  }
  const [sumInsured, setSumInsured] = useState("");
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

  async function submit() {
    const trimmed = name.trim();
    const value = parseDecimal(amount);
    if (!trimmed || !Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const notice = noticeDays.trim() ? Number.parseInt(noticeDays, 10) : null;
      const sumInsuredVal = sumInsured.trim() ? parseDecimal(sumInsured) : null;
      await addContract({
        name: trimmed,
        amount: value,
        interval,
        renewalDate: renewalDate || null,
        cancellationNoticeDays: notice !== null && Number.isFinite(notice) ? notice : null,
        categoryId: categoryId || null,
        accountId: accountId || null,
        targetAccountId: (accountId && targetAccountId) || null,
        // Booking starts today rather than back-filling the contract's whole
        // history: nobody wants a new contract to post two years of charges.
        bookingStartDate: accountId ? today() : null,
        lastBookedDate: null,
        // The kind toggle is authoritative: an ordinary contract never carries
        // an insurance type or a sum insured, whatever the fields last held.
        insuranceType: isInsurance ? insuranceType || null : null,
        sumInsured:
          isInsurance && sumInsuredVal != null && Number.isFinite(sumInsuredVal)
            ? sumInsuredVal
            : null,
      });
      setName("");
      setAmount("");
      setInterval("MONTHLY");
      setCategoryId("");
      setRenewalDate("");
      setNoticeDays("");
      setInsuranceType("");
      setSumInsured("");
      setIsInsurance(false);
      setAccountId("");
      setTargetAccountId("");
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("contracts.form.error"));
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
      });
      await Promise.all(
        c.transactionIds.map((id) => updateSpendingTransaction(id, { recurringId: contract.id })),
      );
      setDismissed((d) => new Set(d).add(`${c.payee}|${c.amount}`));
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("contracts.form.error"));
    }
  }

  function dismissCandidate(c: RecurringCandidate) {
    setDismissed((d) => new Set(d).add(`${c.payee}|${c.amount}`));
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="space-y-6">
      {/* Mount placement is the auto-start gate, same as the other page tours:
          this view only renders once the contracts surface is reachable. */}

      {insuranceEnabled && gaps.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("contracts.coverage.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("contracts.coverage.intro")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {gaps.map((g) => (
              <li key={g}>{insuranceTypeLabel(g)}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Due bookings, reviewed before anything is written — the same rule the
          savings-plans card follows: never post money movements silently. */}
      {due.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("contracts.due.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("contracts.due.intro", { n: due.length })}
          </p>
          <ul className="mt-4 space-y-2">
            {due.map((b) => (
              <li
                key={`${b.contractId}|${b.date}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span>
                  {b.contractName} <span className="text-zinc-500">{formatDate(b.date)}</span>
                </span>
                <span className="tabular-nums text-red-600 dark:text-red-400" data-private>
                  {formatCurrency(b.amount, base)}
                </span>
              </li>
            ))}
          </ul>
          <Button className="mt-4" variant="primary" disabled={booking} onClick={bookDue}>
            {t("contracts.due.book")}
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
                ...data.accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <p className="mt-1 text-sm text-zinc-500">
              {accountId ? t("contracts.form.accountHintOn") : t("contracts.form.accountHintOff")}
            </p>
          </div>
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
                  ...data.accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
              <p className="mt-1 text-sm text-zinc-500">
                {targetAccountId
                  ? t("contracts.form.targetHintOn")
                  : t("contracts.form.targetHintOff")}
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
                ...data.spendingCategories.map((c) => ({
                  value: c.id,
                  label: `${c.groupName} · ${c.name}`,
                })),
              ]}
            />
          </div>
          {/* Ask what KIND of commitment this is before asking anything about
              insurance. The insurance-type dropdown used to render on every
              contract with a "not an insurance" first option, so a streaming
              subscription was asked which insurance it was. `insuranceType`
              was always the discriminator; this just makes the choice
              explicit and hides the fields that do not apply. */}
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
                    // Leaving insurance must not keep a stale type/sum behind
                    // on a contract that is no longer one.
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
                if (e.key === "Enter") void submit();
              }}
              placeholder="0"
              className={inputCls}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={busy || !name.trim() || !amount.trim()}
              onClick={() => void submit()}
            >
              {t("contracts.form.add")}
            </Button>
          </div>
        </div>
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
                {rows.map(({ contract, noticeOpen }) => (
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
                          {contract.renewalDate}
                          {noticeOpen && ` · ${t("contracts.list.noticeOpen")}`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(contract)}>
                          {t("contracts.list.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
