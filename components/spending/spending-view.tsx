"use client";

// Spending ledger + quick-add (ROADMAP #2, flag `spending`): expense/income
// transactions against a balance account, categorised. Everything rides the
// store seam via usePortfolio(); no mode branching. Totals convert each
// transaction's native-currency amount to the base currency at spot (same
// convention as accounts-view.tsx's totals card); ledger rows display the
// native amount, like an account's own row.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { buildCategoryRules, suggestCategory, applyCategoryRules } from "@/lib/finance/categorize";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, SegmentedControl, Toggle } from "@/components/ui/primitives";
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
import { DeleteAction, EditAction, RowActions } from "@/components/ui/row-actions";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "date" | "payee" | "category" | "account" | "amount";
type TxType = "expense" | "income";

export function SpendingView() {
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
  const base = data.profile.currency;

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
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [txType, setTxType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(today());
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [importing, setImporting] = useState(false);

  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("date", "desc");
  const [confirmDelete, setConfirmDelete] = useState<SpendingTransaction | null>(null);
  const [editingTx, setEditingTx] = useState<SpendingTransaction | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [toContract, setToContract] = useState<SpendingTransaction | null>(null);

  /**
   * Turns one booking into a monthly contract, prefilled from the row the user
   * clicked, and links the booking to it so the recurring detector stops
   * offering the same charge as a suggestion.
   *
   * Monthly is assumed because a single booking carries no cadence; the
   * contracts page is where the interval, the booking account and the transfer
   * target get adjusted.
   */
  async function makeContract(tx: SpendingTransaction) {
    const contract = await addContract({
      name: tx.payee,
      amount: Math.abs(tx.amount),
      interval: "MONTHLY",
      renewalDate: null,
      cancellationNoticeDays: null,
      categoryId: tx.categoryId,
      accountId: tx.accountId,
      // Booking resumes after the charge that seeded it, so this one is not
      // posted a second time.
      bookingStartDate: tx.date,
      lastBookedDate: tx.date,
      targetAccountId: null,
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

  const rows = useMemo(
    () =>
      applySort(data.spendingTransactions, (tx, key) => {
        if (key === "date") return tx.date;
        if (key === "payee") return tx.payee;
        if (key === "category") return categoryLabel(tx.categoryId);
        if (key === "account") return accountsById.get(tx.accountId)?.name ?? "";
        return tx.amount;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.spendingTransactions, applySort, accountsById, categoriesById],
  );

  const pager = usePagination(rows);

  function onPayeeBlur() {
    if (categoryId) return;
    const suggestion = suggestCategory(payee, categoryRules);
    if (suggestion) setCategoryId(suggestion);
  }

  async function submit() {
    const magnitude = parseDecimal(amount);
    if (!accountId || !payee.trim() || !date || !Number.isFinite(magnitude) || magnitude <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const signed = txType === "income" ? magnitude : -magnitude;
      // A transfer onto the very account being booked is not a transfer.
      const transfer =
        transferAccountId && transferAccountId !== accountId ? transferAccountId : null;
      if (recurring) {
        // Same inputs, different meaning: the date becomes the first
        // occurrence and the entry starts producing bookings from there,
        // which the review list on this page then offers for confirmation.
        await addPlannedCashflow({
          name: payee.trim(),
          accountId,
          categoryId: categoryId || null,
          amount: signed,
          interval,
          startDate: date,
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
          amount: signed,
          payee: payee.trim(),
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
      setDate(today());
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
      <Card data-tour="spending-form">
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
                onChange={(v) => setTxType(v)}
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
                  data-private
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="spending-date">
                  {recurring ? t("contracts.form.startLabel") : t("spending.form.dateLabel")}
                </label>
                <input
                  id="spending-date"
                  type="date"
                  // Future dates are allowed on purpose: a standing order or a
                  // rate already scheduled is a booking the user knows about
                  // today. The edit dialog never capped the date either, so
                  // capping it here only meant "save it wrong, then correct it".
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
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
                </div>
              )}
              <div>
                <label className="text-sm font-medium" htmlFor="spending-payee">
                  {t("spending.form.payeeLabel")}
                </label>
                <input
                  id="spending-payee"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  onBlur={onPayeeBlur}
                  placeholder={t("spending.form.payeePlaceholder")}
                  className={inputCls}
                  data-private
                />
              </div>
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
                      label: `${c.groupName} · ${c.name}`,
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
                  actually retire a debt. */}
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
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {error && <p className="mr-auto text-sm text-red-600 dark:text-red-400">{error}</p>}
              <Button
                variant="primary"
                disabled={busy || !accountId || !payee.trim() || !amount.trim() || !date}
                onClick={() => void submit()}
              >
                {recurring ? t("spending.form.addRecurring") : t("spending.form.add")}
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Everything that repeats, contracts and planned entries in ONE list:
          whether they live in different tables is the data model's business,
          not something the user should have to know. */}
      <RecurringCard />

      <Card data-tour="spending-table">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("spending.list.title")}</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              {t("spending.import.button")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void autoCategorize()}>
              {t("spending.list.autoCategorize")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setManagingCategories(true)}>
              {t("spending.categories.manage")}
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
              <Th sort={sort} sortKey="payee" onSort={toggleSort}>
                {t("spending.list.payee")}
              </Th>
              <Th sort={sort} sortKey="category" onSort={toggleSort}>
                {t("spending.list.category")}
              </Th>
              <Th sort={sort} sortKey="account" onSort={toggleSort}>
                {t("spending.list.account")}
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
                return (
                  <Tr key={tx.id}>
                    <Td className="text-zinc-500">{formatDate(tx.date)}</Td>
                    <Td className="font-medium" data-private>
                      {tx.payee}
                    </Td>
                    <Td className="text-zinc-500">{categoryLabel(tx.categoryId)}</Td>
                    <Td className="text-zinc-500" data-private>
                      {account?.name ?? "—"}
                    </Td>
                    <Td
                      align="right"
                      className={`tabular-nums ${tx.amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                      data-private
                    >
                      {formatCurrency(tx.amount, currency)}
                    </Td>
                    <Td>
                      <RowActions>
                        {/* Offered only on an expense that is not already
                            tied to a contract: turning income, or a
                            contract's own booking, into a contract is
                            meaningless. Stays a labelled button: it creates
                            a new entity rather than acting on this row. */}
                        {contractsEnabled && tx.amount < 0 && !tx.recurringId && (
                          <Button size="sm" variant="ghost" onClick={() => setToContract(tx)}>
                            {t("spending.list.makeContract")}
                          </Button>
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
        busy={editBusy}
        error={editError}
        onSave={async (id, patch) => {
          setEditBusy(true);
          setEditError(null);
          try {
            await updateSpendingTransaction(id, patch);
            setEditingTx(null);
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
          if (tx) void makeContract(tx);
        }}
        onCancel={() => setToContract(null)}
      />
    </div>
  );
}
