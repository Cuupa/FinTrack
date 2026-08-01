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
import { useSearchParams } from "next/navigation";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { nextBooking as nextContractBooking } from "@/lib/finance/contract-bookings";
import { nextPlannedOccurrence } from "@/lib/finance/planned";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button, Card, PAGE_STACK, PageHeader, Stat } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { RecurringForm } from "@/components/spending/recurring-form";
import { PlannedForm } from "@/components/spending/planned-form";
import { TransactionEditDialog } from "@/components/spending/transaction-edit-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LoadError } from "@/components/ui/load-error";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeature } from "@/lib/flags/flags-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";
import type { SpendingTransaction } from "@/lib/types";
import type { ContractInput } from "@/lib/store/types";
import { DeleteAction, EditAction, RowActions } from "@/components/ui/row-actions";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";

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

  // ?edit=1 lets the list's inline edit button land straight in the editor.
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  // Set while the user decides whether a changed contract also rewrites the
  // payments it has already booked; carries the pending form input.
  const [scopeInput, setScopeInput] = useState<ContractInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<SpendingTransaction | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SpendingTransaction | null>(null);
  const sort = useSort<"date" | "payee" | "category" | "amount">("date", "desc");

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
    return sort.apply(mine, (tx, key) => {
      if (key === "date") return tx.date;
      if (key === "amount") return tx.amount;
      if (key === "payee") return tx.payee;
      const cat = tx.categoryId ? categoriesById.get(tx.categoryId) : null;
      return cat ? `${cat.groupName} · ${cat.name}` : null;
    });
  }, [data.spendingTransactions, kind, id, sort, categoriesById]);

  const booked = bookings.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  function saveFailed(err: unknown, fallback: string): string {
    if (isStorageFullError(err)) return t("common.storageFull");
    const reason = storeErrorReason(err);
    return reason ? `${fallback} ${reason}` : fallback;
  }

  /**
   * Saves the edited contract and, when asked for, carries the change into the
   * payments it has already booked. A loan instalment splits into interest and
   * principal per month, so its booked AMOUNTS are never rewritten from the new
   * instalment (that would post a made-up split) -- name and category still are.
   */
  async function saveContract(input: ContractInput, alsoBooked: boolean) {
    if (!contract) return;
    setBusy(true);
    setError(null);
    try {
      await updateContract(contract.id, input);
      if (alsoBooked) {
        const renamed = input.name !== contract.name;
        const splits = contract.targetAccountId != null;
        for (const tx of bookings) {
          await updateSpendingTransaction(tx.id, {
            categoryId: input.categoryId,
            ...(renamed && tx.payee === contract.name ? { payee: input.name } : {}),
            ...(splits ? {} : { amount: -Math.abs(input.amount) }),
          });
        }
      }
      setScopeInput(null);
      setEditing(false);
    } catch (err) {
      setError(saveFailed(err, t("contracts.form.error")));
    } finally {
      setBusy(false);
    }
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
  // `??` here read a contract without a booking account (accountId null) as
  // "no contract" and dereferenced the missing plan — the page crashed for
  // every entry that only tracks a cost and books nothing.
  const accountId = contract ? contract.accountId : plan!.accountId;

  return (
    <div className={PAGE_STACK}>
      <Link
        href="/spending"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← {t("recurring.detail.back")}
      </Link>
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
          <Table className="mt-4">
            <Thead>
              <Th sort={sort.sort} sortKey="date" onSort={sort.toggle}>
                {t("spending.form.dateLabel")}
              </Th>
              <Th sort={sort.sort} sortKey="payee" onSort={sort.toggle}>
                {t("spending.form.payeeLabel")}
              </Th>
              <Th sort={sort.sort} sortKey="category" onSort={sort.toggle}>
                {t("spending.form.categoryLabel")}
              </Th>
              <Th align="right" sort={sort.sort} sortKey="amount" onSort={sort.toggle}>
                {t("recurring.col.amount")}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {bookings.map((tx) => {
                const cat = tx.categoryId ? categoriesById.get(tx.categoryId) : null;
                const cur = accountsById.get(tx.accountId)?.currency || base;
                return (
                  <Tr key={tx.id}>
                    <Td className="text-zinc-500">{formatDate(tx.date)}</Td>
                    <Td className="font-medium" data-private>
                      {tx.payee}
                    </Td>
                    <Td className="text-zinc-500">
                      {cat ? `${cat.groupName} · ${cat.name}` : t("spending.form.categoryNone")}
                    </Td>
                    <Td
                      align="right"
                      className={`tabular-nums ${
                        tx.amount < 0 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                      data-private
                    >
                      {formatCurrency(tx.amount, cur)}
                    </Td>
                    <Td>
                      <RowActions>
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
                // Only ask when there is something to rewrite and the change
                // would show up in it. A renewal date or a notice period never
                // touches a booked payment, so it saves without a question.
                const touchesBookings =
                  input.amount !== contract.amount ||
                  input.categoryId !== contract.categoryId ||
                  input.name !== contract.name;
                if (bookings.length > 0 && touchesBookings) {
                  setScopeInput(input);
                  return;
                }
                await saveContract(input, false);
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

      {/* Which payments the change applies to. Deliberately not a
          ConfirmDialog: this is a choice between two outcomes, not a yes/no. */}
      {contract && (
        <Modal open={scopeInput !== null} onClose={() => setScopeInput(null)}>
          <Card>
            <h2 className="text-lg font-semibold">{t("recurring.scope.title")}</h2>
            <p className="mt-2 text-sm text-zinc-500">
              {t("recurring.scope.message", { n: bookings.length })}
            </p>
            {contract.targetAccountId != null && (
              <p className="mt-2 text-sm text-zinc-500">{t("recurring.scope.splitHint")}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setScopeInput(null)}>
                {t("tx.cancel")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => scopeInput && void saveContract(scopeInput, true)}
              >
                {t("recurring.scope.all", { n: bookings.length })}
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => scopeInput && void saveContract(scopeInput, false)}
              >
                {t("recurring.scope.future")}
              </Button>
            </div>
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
