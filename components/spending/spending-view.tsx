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

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });
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

  const rows = useMemo(() => {
    const list = [...data.spendingTransactions];
    list.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "date") cmp = x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
      else if (sort.key === "payee") cmp = x.payee.localeCompare(y.payee);
      else if (sort.key === "category") cmp = categoryLabel(x.categoryId).localeCompare(categoryLabel(y.categoryId));
      else if (sort.key === "account") {
        cmp = (accountsById.get(x.accountId)?.name ?? "").localeCompare(
          accountsById.get(y.accountId)?.name ?? "",
        );
      } else cmp = x.amount - y.amount;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.spendingTransactions, sort, accountsById, categoriesById]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

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
          transferAccountId: null,
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
        });
      }
      setAmount("");
      setPayee("");
      setCategoryId("");
      setNote("");
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

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="space-y-6">
      <Card data-tour="spending-form">
        <h2 className="text-lg font-semibold">{t("spending.form.title")}</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">{t("spending.form.noAccounts")}</p>
        ) : (
          <>
            {/* The form reads top to bottom as one decision chain: WHAT kind
                of entry this is (expense or income, one-off or repeating),
                then how much and from where, then what it was for. The two
                controls that change the meaning of every field below them
                therefore sit in their own header row, instead of being two of
                nine equal boxes in one grid. */}
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
                  value={date}
                  // A recurring entry may legitimately start in the future
                  // (a raise from next month); a booking cannot happen later
                  // than today.
                  max={recurring ? undefined : today()}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              {/* Only meaningful for a repeating entry, and right next to the
                  date it repeats from. */}
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
            {/* One action, at the end of the chain -- not a tenth grid cell
                that lands wherever the column count leaves a gap. */}
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
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("date")}>
                    {t("spending.list.date")}
                    {arrow("date")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("payee")}>
                    {t("spending.list.payee")}
                    {arrow("payee")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("category")}>
                    {t("spending.list.category")}
                    {arrow("category")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("account")}>
                    {t("spending.list.account")}
                    {arrow("account")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("amount")}>
                    {t("spending.list.amount")}
                    {arrow("amount")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => {
                  const account = accountsById.get(tx.accountId);
                  const currency = account?.currency || base;
                  return (
                    <tr
                      key={tx.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 text-zinc-500">{formatDate(tx.date)}</td>
                      <td className="px-3 py-2 font-medium" data-private>
                        {tx.payee}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{categoryLabel(tx.categoryId)}</td>
                      <td className="px-3 py-2 text-zinc-500" data-private>
                        {account?.name ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          tx.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}
                        data-private
                      >
                        {formatCurrency(tx.amount, currency)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {/* Offered only on an expense that is not already
                              tied to a contract: turning income, or a
                              contract's own booking, into a contract is
                              meaningless. */}
                          {contractsEnabled && tx.amount < 0 && !tx.recurringId && (
                            <Button size="sm" onClick={() => setToContract(tx)}>
                              {t("spending.list.makeContract")}
                            </Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => setEditingTx(tx)}>
                            {t("spending.list.edit")}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(tx)}>
                            {t("spending.list.delete")}
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
