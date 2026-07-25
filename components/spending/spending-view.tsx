"use client";

// Spending ledger + quick-add (ROADMAP #2, flag `spending`): expense/income
// transactions against a balance account, categorised. Everything rides the
// store seam via usePortfolio(); no mode branching. Totals convert each
// transaction's native-currency amount to the base currency at spot (same
// convention as accounts-view.tsx's totals card); ledger rows display the
// native amount, like an account's own row.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import { incomeExpenseSplit, toBaseCurrency } from "@/lib/finance/spending";
import { buildCategoryRules, suggestCategory, applyCategoryRules } from "@/lib/finance/categorize";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";
import { CategoryManager } from "./category-manager";
import { ImportSpending } from "./import-spending";
import { SpendingSankeyCard } from "./spending-sankey-card";
import { BudgetsCard } from "./budgets-card";
import type { SpendingTransaction } from "@/lib/types";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "date" | "payee" | "category" | "account" | "amount";
type TxType = "expense" | "income";

export function SpendingView() {
  const {
    data,
    addSpendingTransaction,
    updateSpendingTransaction,
    deleteSpendingTransaction,
  } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;

  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );
  const categoriesById = useMemo(
    () => new Map(data.spendingCategories.map((c) => [c.id, c])),
    [data.spendingCategories],
  );

  const totals = useMemo(() => {
    const converted = toBaseCurrency(data.spendingTransactions, data.accounts, base, valuation.fx);
    return incomeExpenseSplit(converted);
  }, [data.spendingTransactions, data.accounts, base, valuation.fx]);

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [importing, setImporting] = useState(false);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });
  const [confirmDelete, setConfirmDelete] = useState<SpendingTransaction | null>(null);

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
      await addSpendingTransaction({
        accountId,
        categoryId: categoryId || null,
        date,
        amount: txType === "income" ? magnitude : -magnitude,
        payee: payee.trim(),
        note: note.trim() || null,
        recurringId: null,
      });
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
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label={t("spending.totals.income")} value={formatCurrency(totals.income, base)} isPrivate />
          <Stat label={t("spending.totals.expense")} value={formatCurrency(totals.expense, base)} isPrivate />
          <Stat
            label={t("spending.totals.net")}
            value={formatCurrency(totals.net, base)}
            valueClassName={totals.net < 0 ? "text-red-600 dark:text-red-400" : ""}
            isPrivate
          />
        </div>
      </Card>

      <SpendingSankeyCard />

      <BudgetsCard />

      <Card>
        <h2 className="text-lg font-semibold">{t("spending.form.title")}</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">{t("spending.form.noAccounts")}</p>
        ) : (
          <>
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
                <label className="text-sm font-medium">{t("spending.form.typeLabel")}</label>
                <div className="mt-1 flex gap-2">
                  <Button
                    type="button"
                    variant={txType === "expense" ? "primary" : "secondary"}
                    onClick={() => setTxType("expense")}
                  >
                    {t("spending.form.type.expense")}
                  </Button>
                  <Button
                    type="button"
                    variant={txType === "income" ? "primary" : "secondary"}
                    onClick={() => setTxType("income")}
                  >
                    {t("spending.form.type.income")}
                  </Button>
                </div>
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
              <div>
                <label className="text-sm font-medium" htmlFor="spending-date">
                  {t("spending.form.dateLabel")}
                </label>
                <input
                  id="spending-date"
                  type="date"
                  value={date}
                  max={today()}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
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
              <div className="flex items-end">
                <Button
                  variant="primary"
                  disabled={busy || !accountId || !payee.trim() || !amount.trim() || !date}
                  onClick={() => void submit()}
                >
                  {t("spending.form.add")}
                </Button>
              </div>
            </div>
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}
      </Card>

      <Card>
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
                      <td className="px-3 py-2 text-zinc-500">{tx.date}</td>
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
                        <div className="flex justify-end">
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
    </div>
  );
}
