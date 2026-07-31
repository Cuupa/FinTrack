"use client";

// Detail view for one recurring entry: what it is, and every booking it has
// produced.
//
// The merged list on /spending answers "what recurs"; this answers "and what
// has it actually cost me". Without it the bookings a contract generated were
// only findable by scrolling the whole ledger and matching on the payee, which
// is not a way to check whether a standing charge is behaving.
//
// `kind` in the route distinguishes the two sources ("contract" | "planned").
// They stay separate entities in the store — one carries a cancellation
// notice, the other a signed amount and ONCE/WEEKLY — but the user never has
// to know which one they clicked.

import { use, useMemo, useState } from "react";
import Link from "next/link";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { nextBooking as nextContractBooking } from "@/lib/finance/contract-bookings";
import { nextPlannedOccurrence } from "@/lib/finance/planned";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button, Card, PAGE_STACK, PageHeader, Stat } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { RecurringForm } from "@/components/spending/recurring-form";
import { PlannedForm } from "@/components/spending/planned-card";
import { TransactionEditDialog } from "@/components/spending/transaction-edit-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LoadError } from "@/components/ui/load-error";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeature } from "@/lib/flags/flags-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";
import type { SpendingTransaction } from "@/lib/types";

type SortKey = "date" | "amount";

export default function RecurringDetailPage({
  params,
}: {
  // Next 16: dynamic params arrive as a Promise, unwrapped with `use`.
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = use(params);
  const {
    data,
    loading,
    loadError,
    reload,
    updateContract,
    updatePlannedCashflow,
    updateSpendingTransaction,
    deleteSpendingTransaction,
  } = usePortfolio();
  const { t } = useI18n();
  const insurance = useFeature("insurance");
  const base = data.profile.currency;
  const todayIso = today();

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<SpendingTransaction | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SpendingTransaction | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });

  const contract = kind === "contract" ? data.contracts.find((c) => c.id === id) : undefined;
  const plan = kind === "planned" ? data.plannedCashflows.find((p) => p.id === id) : undefined;

  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );
  const categoriesById = useMemo(
    () => new Map(data.spendingCategories.map((c) => [c.id, c])),
    [data.spendingCategories],
  );

  // Every booking this entry produced. A split loan instalment posts two rows
  // carrying the same `recurringId`, so both show up here side by side, which
  // is exactly the point of the page.
  const bookings = useMemo(() => {
    const mine = data.spendingTransactions.filter((tx) =>
      kind === "contract" ? tx.recurringId === id : tx.plannedId === id,
    );
    mine.sort((x, y) => {
      const cmp =
        sort.key === "date" ? (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) : x.amount - y.amount;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return mine;
  }, [data.spendingTransactions, kind, id, sort]);

  const booked = bookings.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  function saveFailed(err: unknown, fallback: string): string {
    if (isStorageFullError(err)) return t("common.storageFull");
    const reason = storeErrorReason(err);
    return reason ? `${fallback} ${reason}` : fallback;
  }

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  if (loadError) {
    return (
      <div className={PAGE_STACK}>
        <LoadError onRetry={reload} />
      </div>
    );
  }
  if (loading) {
    return (
      <div className={PAGE_STACK}>
        <Card>
          <div className="h-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
        </Card>
      </div>
    );
  }
  if (!contract && !plan) {
    return (
      <div className={PAGE_STACK}>
        <PageHeader title={t("recurring.detail.notFoundTitle")} />
        <Card>
          <p className="text-sm text-zinc-500">{t("recurring.detail.notFound")}</p>
          <Link className="mt-3 inline-block text-sm underline" href="/spending">
            {t("recurring.detail.back")}
          </Link>
        </Card>
      </div>
    );
  }

  const name = contract?.name ?? plan!.name;
  const amount = contract ? -Math.abs(contract.amount) : plan!.amount;
  const currency = contract ? base : accountsById.get(plan!.accountId)?.currency || base;
  const next = contract
    ? nextContractBooking(contract, todayIso)
    : nextPlannedOccurrence(plan!, todayIso);
  const accountId = contract?.accountId ?? plan!.accountId;

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";
  const thPlainCls =
    "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";

  return (
    <div className={PAGE_STACK}>
      <PageHeader
        title={name}
        subtitle={t("recurring.detail.subtitle")}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t("contracts.list.edit")}
          </Button>
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Stat
            label={t("recurring.col.amount")}
            value={formatCurrency(amount, currency)}
            isPrivate
          />
          <Stat
            label={t("recurring.col.interval")}
            value={t(
              `recurring.interval.${contract?.interval ?? plan!.interval}` as Parameters<
                typeof t
              >[0],
            )}
          />
          <Stat
            label={t("recurring.col.next")}
            value={next ? formatDate(next) : t("recurring.noNext")}
          />
          <Stat
            label={t("recurring.detail.bookedTotal")}
            value={formatCurrency(-booked, base)}
            isPrivate
          />
        </div>
        <p className="mt-3 text-sm text-zinc-500">
          {accountsById.get(accountId ?? "")?.name ?? t("recurring.detail.noAccount")}
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("recurring.detail.bookings")}</h2>
        {bookings.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("recurring.detail.noBookings")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("date")}>
                    {t("spending.form.dateLabel")}
                    {arrow("date")}
                  </th>
                  <th className={thPlainCls}>{t("spending.form.payeeLabel")}</th>
                  <th className={thPlainCls}>{t("spending.form.categoryLabel")}</th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("amount")}>
                    {t("recurring.col.amount")}
                    {arrow("amount")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {bookings.map((tx) => {
                  const cat = tx.categoryId ? categoriesById.get(tx.categoryId) : null;
                  const cur = accountsById.get(tx.accountId)?.currency || base;
                  return (
                    <tr
                      key={tx.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 text-zinc-500">{formatDate(tx.date)}</td>
                      <td className="px-3 py-2 font-medium" data-private>
                        {tx.payee}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">
                        {cat ? `${cat.groupName} · ${cat.name}` : t("spending.form.categoryNone")}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          tx.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}
                        data-private
                      >
                        {formatCurrency(tx.amount, cur)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
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
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </Card>

      {contract && (
        <Modal open={editing} onClose={() => setEditing(false)} maxWidthClass="max-w-5xl">
          <Card>
            <h2 className="text-lg font-semibold">{t("contracts.edit.title")}</h2>
            <RecurringForm
              key={contract.id}
              accounts={data.accounts}
              categories={data.spendingCategories}
              base={base}
              insuranceEnabled={insurance.enabled && !insurance.locked}
              initial={contract}
              submitLabel={t("contracts.edit.save")}
              busy={busy}
              onSubmit={async (input) => {
                setBusy(true);
                setError(null);
                try {
                  await updateContract(contract.id, input);
                  setEditing(false);
                } catch (err) {
                  setError(saveFailed(err, t("contracts.form.error")));
                } finally {
                  setBusy(false);
                }
              }}
              onCancel={() => setEditing(false)}
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </Card>
        </Modal>
      )}

      {plan && (
        <Modal open={editing} onClose={() => setEditing(false)} maxWidthClass="max-w-3xl">
          <Card>
            <h2 className="text-lg font-semibold">{t("spending.planned.editTitle")}</h2>
            <div className="mt-4">
              <PlannedForm
                key={plan.id}
                initial={plan}
                submitLabel={t("spending.planned.save")}
                onSubmit={async (input) => {
                  setError(null);
                  try {
                    await updatePlannedCashflow(plan.id, input);
                    setEditing(false);
                  } catch (err) {
                    setError(saveFailed(err, t("spending.form.error")));
                  }
                }}
                onCancel={() => setEditing(false)}
              />
            </div>
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </Card>
        </Modal>
      )}

      <TransactionEditDialog
        transaction={editingTx}
        accounts={data.accounts}
        categories={data.spendingCategories}
        busy={txBusy}
        error={txError}
        onSave={async (txId, patch) => {
          setTxBusy(true);
          setTxError(null);
          try {
            await updateSpendingTransaction(txId, patch);
            setEditingTx(null);
          } catch (err) {
            setTxError(saveFailed(err, t("spending.form.error")));
          } finally {
            setTxBusy(false);
          }
        }}
        onClose={() => {
          setEditingTx(null);
          setTxError(null);
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("spending.delete.title")}
        message={
          confirmDelete ? t("spending.delete.message", { payee: confirmDelete.payee }) : undefined
        }
        confirmLabel={t("spending.list.delete")}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target) return;
          setError(null);
          void deleteSpendingTransaction(target.id).catch((err: unknown) => {
            setError(saveFailed(err, t("spending.form.error")));
          });
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
