"use client";

// Spending ledger + quick-add (ROADMAP #2, flag `spending`): expense/income
// transactions against a balance account, categorised. Everything rides the
// store seam via usePortfolio(); no mode branching. Totals convert each
// transaction's native-currency amount to the base currency at spot (same
// convention as accounts-view.tsx's totals card); ledger rows display the
// native amount, like an account's own row.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { nowDateTimeLocal, timeframeStart, today, type Timeframe } from "@/lib/finance/dates";
import { buildCategoryRules, suggestCategory, applyCategoryRules } from "@/lib/finance/categorize";
import { formatCurrency, formatDateTime, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, SegmentedControl, Toggle } from "@/components/ui/primitives";
import { inMonth } from "@/components/ui/month-picker";
import { FormActions } from "@/components/ui/form-actions";
import { SelectMenu } from "@/components/ui/select-menu";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";
import { CategoryManager } from "./category-manager";
import { TransactionEditDialog } from "./transaction-edit-dialog";
import { ImportSpending } from "./import-spending";
// Sankey, forecast and budgets moved to /cashflow (owner call): this page had
// grown to eight containers. It now answers "what did I book, and what
// recurs"; the analysis of where the money goes lives one page over.
import { RecurringCard } from "./recurring-card";
import { PLANNED_INTERVALS, type PlannedInterval, type SpendingTransaction } from "@/lib/types";
import { DeleteAction, EditAction, RecurringAction, RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/lib/notifications/toast-context";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "date" | "payee" | "payer" | "category" | "amount";

/** The two counterparty columns shrink to their content instead of taking an
 *  equal share of the row's width. */
const counterpartyCls = "w-0 whitespace-nowrap";

/** Oldest booking date, the anchor a MAX timeframe resolves against. */
function earliestBookingDate(txs: readonly { date: string }[]): string | null {
  let min: string | null = null;
  for (const tx of txs) if (min === null || tx.date < min) min = tx.date;
  return min;
}
type TxType = "expense" | "income";

/** Which of the two counterparty columns a booking belongs in. The sign is the
 *  only thing that says it: a negative amount left the account, so the
 *  counterparty received it. A zero booking has no direction and files with the
 *  income side, where the amount column does not paint it red either. */
function isMoneyOut(tx: { amount: number }): boolean {
  return tx.amount < 0;
}

export function SpendingView({
  accountIds: scopeAccountIds = [],
  timeframe,
  month = null,
}: {
  /** Narrows the ledger to the selected accounts and prefills the entry mask
   *  with the first of them. Empty means every account, which is how this view
   *  behaved before /accounts absorbed it. */
  accountIds?: string[];
  /** Narrows the ledger to the window the accounts chart is showing, so the
   *  bookings under it are the ones that produced that curve. */
  timeframe?: Timeframe;
  /** `YYYY-MM` from the page header, or null. A chosen month wins over the
   *  chart's rolling window: both answer "which bookings", and the month is
   *  the one the user just set. */
  month?: string | null;
} = {}) {
  const {
    data,
    addSpendingTransaction,
    addPlannedCashflow,
    updateSpendingTransaction,
    deleteSpendingTransaction,
    addContract,
  } = usePortfolio();
  const { t } = useI18n();
  const contractsEnabled = useFeatureFlag("contracts");
  const todayIso = today();
  const base = data.profile.currency;
  const { showToast } = useToast();

  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );
  const categoriesById = useMemo(
    () => new Map(data.spendingCategories.map((c) => [c.id, c])),
    [data.spendingCategories],
  );

  const categoryRules = useMemo(
    () => buildCategoryRules(data.spendingTransactions),
    [data.spendingTransactions],
  );

  // Quick-add form state.
  // The PICKED account, which may be empty (no accounts existed when this
  // mounted) or stale (the account was deleted). `accountId` below resolves
  // that, derived rather than synced in an effect -- Next 16 fails the build on
  // setState inside one, and the page now creates accounts alongside this form,
  // so "there were none at mount" is the normal case rather than an edge one.
  const [pickedAccountId, setPickedAccountId] = useState("");
  const [txType, setTxType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [dateTime, setDateTime] = useState(nowDateTimeLocal);
  const [note, setNote] = useState("");
  // Where the money lands when it is not consumed: another account of the
  // user's own, a liability included. Booking a rate onto a credit is the
  // whole point of tracking one, and it was reachable only by saving the
  // booking first and re-opening it in the edit dialog.
  const [transferAccountId, setTransferAccountId] = useState("");
  // The one toggle that decides whether this is a single booking or something
  // that repeats. Owner rule: adding a recurring payment is the SAME act as
  // adding a booking, so it is one form with a switch, never a second place
  // to go and never a separate "new" button.
  const [recurring, setRecurring] = useState(false);
  const [interval, setInterval] = useState<PlannedInterval>("MONTHLY");
  const [monthEnd, setMonthEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [importing, setImporting] = useState(false);

  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("date", "desc");
  const [confirmDelete, setConfirmDelete] = useState<SpendingTransaction | null>(null);
  const [editingTx, setEditingTx] = useState<SpendingTransaction | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [toContract, setToContract] = useState<SpendingTransaction | null>(null);

  // Falls back to the first account the page is scoped to, then to the first
  // one that exists, so the submit button is never disabled by a selection the
  // user cannot see or change. A booking lands on ONE account even when the
  // page is showing several, so the mask picks the first rather than nothing.
  const accountId =
    pickedAccountId && data.accounts.some((a) => a.id === pickedAccountId)
      ? pickedAccountId
      : (scopeAccountIds[0] ?? data.accounts[0]?.id ?? "");
  const setAccountId = setPickedAccountId;

  /** Money in reads differently from money out, so the form follows the tab. */
  const isIncome = txType === "income";
  /** Month-end only has a meaning for the month-based cadences. */
  const monthEndApplies = interval !== "ONCE" && interval !== "WEEKLY";

  /**
   * Turns one booking into a monthly recurring entry, prefilled from the row
   * the user clicked, and links the booking to it so the detector stops
   * offering the same charge as a suggestion.
   *
   * Monthly is assumed because a single booking carries no cadence; the
   * entry's own page is where the interval, the account and the transfer
   * target get adjusted.
   */
  async function makeRecurring(tx: SpendingTransaction) {
    // Income promotes to a planned cashflow, not a contract. A Contract is a
    // commitment to PAY (unsigned amount, always rendered as money out), so a
    // salary filed as one would read as a standing charge -- which is why this
    // action used to be withheld from income rows entirely. The recurring card
    // merges both entities anyway, so the user never sees the distinction.
    if (tx.amount > 0) {
      const plan = await addPlannedCashflow({
        name: tx.payee,
        accountId: tx.accountId,
        categoryId: tx.categoryId,
        amount: tx.amount,
        interval: "MONTHLY",
        startDate: tx.date,
        endDate: null,
        // Booking resumes after the one that seeded it, so this one is not
        // posted a second time.
        lastBookedDate: tx.date,
        // Carried over, not dropped: a booking that moves money to another of
        // your own accounts still does so every month. Nulling it here turned
        // a loan instalment into a consumed expense the moment it was
        // promoted, which stopped it retiring the debt.
        transferAccountId: tx.transferAccountId ?? null,
        note: null,
      });
      await updateSpendingTransaction(tx.id, { plannedId: plan.id });
      return;
    }
    const contract = await addContract({
      name: tx.payee,
      amount: Math.abs(tx.amount),
      interval: "MONTHLY",
      renewalDate: null,
      cancellationNoticeDays: null,
      categoryId: tx.categoryId,
      accountId: tx.accountId,
      bookingStartDate: tx.date,
      lastBookedDate: tx.date,
      // Same carry-over as above: `Contract.targetAccountId` is the field that
      // makes a rate actually retire a debt.
      targetAccountId: tx.transferAccountId ?? null,
      insuranceType: null,
      sumInsured: null,
    });
    await updateSpendingTransaction(tx.id, { recurringId: contract.id });
  }

  function categoryLabel(id: string | null): string {
    if (!id) return t("spending.list.uncategorized");
    const c = categoriesById.get(id);
    return c ? `${c.groupName} · ${c.name}` : t("spending.list.uncategorized");
  }

  // A transfer shows up on BOTH accounts it touches, so scoping keeps a booking
  // whose TARGET is in the selection -- otherwise a rate paid into the mortgage
  // would be missing from the mortgage's own statement. With several accounts
  // picked a transfer between two of them is one booking, not two: it is the
  // same row matching on either side.
  const scoped = useMemo(() => {
    const from =
      !month && timeframe
        ? timeframeStart(timeframe, todayIso, earliestBookingDate(data.spendingTransactions))
        : null;
    return data.spendingTransactions.filter((tx) => {
      if (!inMonth(tx.date, month)) return false;
      if (from && tx.date < from) return false;
      if (scopeAccountIds.length === 0) return true;
      return (
        scopeAccountIds.includes(tx.accountId) ||
        (tx.transferAccountId != null && scopeAccountIds.includes(tx.transferAccountId))
      );
    });
  }, [data.spendingTransactions, scopeAccountIds, timeframe, todayIso, month]);

  const rows = useMemo(
    () =>
      applySort(scoped, (tx, key) => {
        if (key === "date") return tx.date;
        // Each column sorts by the name actually standing in it, which is the
        // counterparty on one side and the booking's own account on the other.
        const ownName = accountsById.get(tx.accountId)?.name ?? "";
        if (key === "payee") return isMoneyOut(tx) ? tx.payee : ownName;
        if (key === "payer") return isMoneyOut(tx) ? ownName : tx.payee;
        if (key === "category") return categoryLabel(tx.categoryId);
        return tx.amount;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, applySort, accountsById, categoriesById],
  );

  const pager = usePagination(rows);

  function onPayeeBlur() {
    if (categoryId) return;
    const suggestion = suggestCategory(payee, categoryRules);
    if (suggestion) setCategoryId(suggestion);
  }

  // A transfer onto the very account being booked is not a transfer.
  const transfer =
    transferAccountId && transferAccountId !== accountId ? transferAccountId : null;
  // The transfer picker already names where the money went, so the payee is
  // optional there and falls back to the target account. Demanding a recipient
  // for "Umbuchung auf Hundekonto" asked a question the picker had answered.
  const effectivePayee =
    payee.trim() || (transfer ? (accountsById.get(transfer)?.name ?? "") : "");

  async function submit() {
    const magnitude = parseDecimal(amount);
    const date = dateTime.slice(0, 10);
    if (!accountId || !effectivePayee || !dateTime || !Number.isFinite(magnitude) || magnitude <= 0)
      return;
    setBusy(true);
    setError(null);
    try {
      const signed = txType === "income" ? magnitude : -magnitude;
      if (recurring) {
        // Same inputs, different meaning: the date becomes the first
        // occurrence and the entry starts producing bookings from there,
        // which the review list on this page then offers for confirmation.
        await addPlannedCashflow({
          name: effectivePayee,
          accountId,
          categoryId: categoryId || null,
          amount: signed,
          interval,
          startDate: date,
          // Never stored for a cadence it cannot apply to, so switching to
          // weekly after ticking it does not leave a hidden flag behind.
          monthEnd: monthEndApplies && monthEnd,
          endDate: null,
          lastBookedDate: null,
          transferAccountId: transfer,
          note: note.trim() || null,
        });
      } else {
        await addSpendingTransaction({
          accountId,
          categoryId: categoryId || null,
          date,
          bookedAt: dateTime,
          amount: signed,
          payee: effectivePayee,
          note: note.trim() || null,
          recurringId: null,
          transferAccountId: transfer,
        });
      }
      setAmount("");
      setPayee("");
      setCategoryId("");
      setNote("");
      setTransferAccountId("");
      setDateTime(nowDateTimeLocal());
      setAdding(false);
      showToast(t("spending.form.saved"));
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("spending.form.error"));
    } finally {
      setBusy(false);
    }
  }

  async function autoCategorize() {
    const updates = applyCategoryRules(data.spendingTransactions);
    for (const u of updates) {
      await updateSpendingTransaction(u.id, { categoryId: u.categoryId });
    }
  }

  return (
    <div className="space-y-6">
      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
          setError(null);
        }}
        maxWidthClass="max-w-4xl"
      >
      <Card>
        <h2 className="text-lg font-semibold">{t("spending.form.title")}</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">{t("spending.form.noAccounts")}</p>
        ) : (
          <>
            {/* The two controls that change what every field below means sit
                in their own header row. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
              <SegmentedControl
                value={txType}
                onChange={(v) => {
                  setTxType(v);
                  // The transfer picker is hidden on income; a value typed
                  // before the switch would otherwise still be submitted from
                  // a field the user can no longer see.
                  if (v === "income") setTransferAccountId("");
                }}
                options={[
                  { value: "expense", label: t("spending.form.type.expense") },
                  { value: "income", label: t("spending.form.type.income") },
                ]}
              />
              <Toggle
                id="spending-recurring"
                checked={recurring}
                onChange={setRecurring}
                label={t("spending.form.recurring")}
                hint={t("spending.form.recurringHint")}
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-sm font-medium">{t("spending.form.accountLabel")}</label>
                <SelectMenu
                  className="mt-1 w-full"
                  ariaLabel={t("spending.form.accountLabel")}
                  value={accountId}
                  onChange={setAccountId}
                  options={data.accounts.map((a) => ({ value: a.id, label: a.name }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="spending-amount">
                  {t("spending.form.amountLabel", {
                    currency: accountsById.get(accountId)?.currency || base,
                  })}
                </label>
                <input
                  id="spending-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
                  placeholder="0"
                  className={inputCls}
                  data-private={amount !== "" ? "" : undefined}
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="spending-date">
                  {recurring ? t("contracts.form.startLabel") : t("spending.form.dateLabel")}
                </label>
                <input
                  id="spending-date"
                  type="datetime-local"
                  // Future dates are allowed on purpose: a standing order or a
                  // rate already scheduled is a booking the user knows about
                  // today. The edit dialog never capped the date either, so
                  // capping it here only meant "save it wrong, then correct it".
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                  className={inputCls}
                />
              </div>
              {recurring && (
                <div>
                  <label className="text-sm font-medium">{t("recurring.col.interval")}</label>
                  <SelectMenu
                    className="mt-1 w-full"
                    ariaLabel={t("recurring.col.interval")}
                    value={interval}
                    onChange={(v) => setInterval(v as PlannedInterval)}
                    options={PLANNED_INTERVALS.map((i) => ({
                      value: i,
                      label: t(`recurring.interval.${i}` as Parameters<typeof t>[0]),
                    }))}
                  />
                  {/* Offered only where it means something: "the last day of
                      the month" is not a weekly cadence, and a one-off is a
                      date the user already picked outright. */}
                  {monthEndApplies && (
                    <div className="mt-2">
                      <Toggle
                        checked={monthEnd}
                        onChange={setMonthEnd}
                        label={t("recurring.monthEnd")}
                      />
                    </div>
                  )}
                </div>
              )}
              {/* Money out has a recipient, money in has a source. One field,
                  but calling a salary's employer the "payee" was backwards. */}
              {!transfer ? (
                <div>
                  <label className="text-sm font-medium" htmlFor="spending-payee">
                    {t(isIncome ? "spending.form.payerLabel" : "spending.form.payeeLabel")}
                  </label>
                  <input
                    id="spending-payee"
                    value={payee}
                    onChange={(e) => setPayee(e.target.value)}
                    onBlur={onPayeeBlur}
                    placeholder={t(
                      isIncome ? "spending.form.payerPlaceholder" : "spending.form.payeePlaceholder",
                    )}
                    className={inputCls}
                    data-private={payee !== "" ? "" : undefined}
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
                  <span className="font-medium">{t("spending.edit.transferLabel")}</span>
                  <p className="mt-1 text-zinc-500" data-private>
                    {accountsById.get(transfer)?.name}
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">{t("spending.form.categoryLabel")}</label>
                <SelectMenu
                  className="mt-1 w-full"
                  ariaLabel={t("spending.form.categoryLabel")}
                  value={categoryId}
                  onChange={setCategoryId}
                  searchable
                  options={[
                    { value: "", label: t("spending.form.categoryNone") },
                    ...data.spendingCategories.map((c) => ({
                      value: c.id,
                      label: c.name,
                      group: c.groupName,
                    })),
                  ]}
                  footer={(close) => (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setManagingCategories(true);
                      }}
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                    >
                      {t("spending.categories.manage")}
                    </button>
                  )}
                />
              </div>
              {/* Same control and same words as the edit dialog: marking a
                  booking as a transfer keeps it out of the expense figures and
                  moves the other account instead, which is what makes a rate
                  actually retire a debt.

                  Expenses only. "Transfer TO" describes money leaving THIS
                  account for another of your own; on an income booking the
                  money is arriving, so the field asked a question with no
                  answer. The same move is recorded as an expense from the
                  account it actually leaves. */}
              {!isIncome && (
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
              )}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium" htmlFor="spending-note">
                  {t("spending.form.noteLabel")}
                </label>
                <input
                  id="spending-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("spending.form.notePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  className={inputCls}
                />
              </div>
            </div>
            <FormActions error={error}>
              <Button
                variant="primary"
                disabled={busy || !accountId || !effectivePayee || !amount.trim() || !dateTime}
                onClick={() => void submit()}
              >
                {recurring ? t("spending.form.addRecurring") : t("spending.form.add")}
              </Button>
            </FormActions>
          </>
        )}
      </Card>
      </Modal>

      {/* Everything that repeats, contracts and planned entries in ONE list:
          whether they live in different tables is the data model's business,
          not something the user should have to know. */}
      <RecurringCard />

      <Card data-tour="spending-table">
        {/* Every button that acts on this list lives in this list's header
            (owner rule) -- "add booking" used to float above the card it fills. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("spending.list.title")}</h2>
          <div className="flex flex-wrap gap-2" data-tour="spending-form">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              {t("spending.import.button")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void autoCategorize()}>
              {t("spending.list.autoCategorize")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setManagingCategories(true)}>
              {t("spending.categories.manage")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
            >
              {t("spending.form.title")}
            </Button>
          </div>
        </div>
        {data.spendingTransactions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("spending.list.empty")}</p>
        ) : (
          <>
          <Table className="mt-4">
            <Thead>
              <Th sort={sort} sortKey="date" onSort={toggleSort}>
                {t("spending.list.date")}
              </Th>
              {/* Both sides of a booking always exist, so both columns are
                  always filled: moving money from the Stadtsparkasse to the
                  solar loan makes the Stadtsparkasse the PAYER, not a blank.
                  The account the booking sits on is one of the two parties --
                  which is why there is no separate account column any more, it
                  repeated one of these two names in every single row. */}
              <Th className={counterpartyCls} sort={sort} sortKey="payee" onSort={toggleSort}>
                {t("spending.list.payee")}
              </Th>
              <Th className={counterpartyCls} sort={sort} sortKey="payer" onSort={toggleSort}>
                {t("spending.list.payer")}
              </Th>
              <Th sort={sort} sortKey="category" onSort={toggleSort}>
                {t("spending.list.category")}
              </Th>
              <Th align="right" sort={sort} sortKey="amount" onSort={toggleSort}>
                {t("spending.list.amount")}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {pager.rows.map((tx) => {
                const account = accountsById.get(tx.accountId);
                const currency = account?.currency || base;
                const out = isMoneyOut(tx);
                // Muted like the old account column: your own account keeps the
                // weight it had there, so the bold name in the row is still the
                // party outside your books.
                const own = (
                  <span className="font-normal text-zinc-500">{account?.name ?? "—"}</span>
                );
                return (
                  <Tr key={tx.id}>
                    <Td className="whitespace-nowrap text-zinc-500">
                      {formatDateTime(tx.bookedAt ?? tx.date)}
                    </Td>
                    <Td className={`font-medium ${counterpartyCls}`} data-private>
                      {out ? tx.payee : own}
                    </Td>
                    <Td className={`font-medium ${counterpartyCls}`} data-private>
                      {out ? own : tx.payee}
                    </Td>
                    <Td className="text-zinc-500">{categoryLabel(tx.categoryId)}</Td>
                    <Td
                      align="right"
                      className={`tabular-nums ${tx.amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                      data-private
                    >
                      {formatCurrency(tx.amount, currency)}
                    </Td>
                    <Td>
                      <RowActions>
                        {/* Withheld only from a row that already belongs to a
                            recurring entry -- the charge is registered
                            somewhere, so offering to register it again is
                            noise. Income qualifies exactly like an expense;
                            `makeRecurring` picks the right entity. */}
                        {contractsEnabled && !tx.recurringId && !tx.plannedId && (
                          <RecurringAction
                            label={t("spending.list.makeContract")}
                            onClick={() => setToContract(tx)}
                          />
                        )}
                        <EditAction
                          label={t("spending.list.edit")}
                          onClick={() => setEditingTx(tx)}
                        />
                        <DeleteAction
                          label={t("spending.list.delete")}
                          onClick={() => setConfirmDelete(tx)}
                        />
                      </RowActions>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
            <TablePagination pager={pager} />
          </>
        )}
      </Card>

      {/* A booking is the row you get wrong most often (bank-abbreviated payee,
          guessed category, mistyped amount), so it is editable rather than
          delete-and-retype — which would also throw away its `recurringId`. */}
      <TransactionEditDialog
        transaction={editingTx}
        accounts={data.accounts}
        categories={data.spendingCategories}
        baseCurrency={base}
        busy={editBusy}
        error={editError}
        onSave={async (id, patch) => {
          setEditBusy(true);
          setEditError(null);
          try {
            await updateSpendingTransaction(id, patch);
            setEditingTx(null);
            showToast(t("spending.form.saved"));
          } catch (err) {
            // A failed write must say WHY: the store surfaces the database's
            // own message (missing column, check constraint, RLS refusal).
            const reason = storeErrorReason(err);
            setEditError(
              isStorageFullError(err)
                ? t("common.storageFull")
                : reason
                  ? `${t("spending.form.error")} ${reason}`
                  : t("spending.form.error"),
            );
          } finally {
            setEditBusy(false);
          }
        }}
        onClose={() => {
          setEditingTx(null);
          setEditError(null);
        }}
      />

      <CategoryManager open={managingCategories} onClose={() => setManagingCategories(false)} />

      <Modal open={importing} onClose={() => setImporting(false)} maxWidthClass="max-w-2xl">
        <Card>
          <h2 className="text-lg font-semibold">{t("spending.import.title")}</h2>
          <div className="mt-4">
            <ImportSpending onDone={() => setImporting(false)} />
          </div>
        </Card>
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("spending.delete.title")}
        message={confirmDelete ? t("spending.delete.message", { payee: confirmDelete.payee }) : undefined}
        confirmLabel={t("spending.list.delete")}
        onConfirm={() => {
          if (confirmDelete) void deleteSpendingTransaction(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Creating is not destructive, but it does add a recurring commitment
          that will start booking — worth one confirmation. */}
      <ConfirmDialog
        open={toContract !== null}
        title={t("spending.list.makeContractTitle")}
        message={t("spending.list.makeContractMsg", { payee: toContract?.payee ?? "" })}
        confirmLabel={t("spending.list.makeContract")}
        onConfirm={() => {
          const tx = toContract;
          setToContract(null);
          if (tx) void makeRecurring(tx);
        }}
        onCancel={() => setToContract(null)}
      />
    </div>
  );
}
