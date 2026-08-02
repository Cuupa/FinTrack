"use client";

// Editing a booking after the fact (/spending row action).
//
// Every other entity on the everyday side is editable — a contract, a goal, an
// account — and a ledger row is the one you get wrong most often: the payee is
// abbreviated by the bank, the category was guessed by `categorize.ts`, the
// amount was typed in a hurry. Deleting and re-entering was the only way, and
// that loses the row's provenance (`recurringId`/`plannedId`) along with it.
//
// Which is exactly why those two fields are NOT editable here: they say where
// the booking came from (a contract's charge, a planned salary), and the
// contract/plan advances its own `lastBookedDate` against them. The user edits
// what the booking IS, never what produced it.

import { useState } from "react";

import type { Account, SpendingCategory, SpendingTransaction } from "@/lib/types";
import type { SpendingTransactionInput } from "@/lib/store/types";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, SegmentedControl } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900";

export interface TransactionEditDialogProps {
  /** The booking being edited; null closes the dialog. */
  transaction: SpendingTransaction | null;
  accounts: Account[];
  categories: SpendingCategory[];
  /** Profile base currency. An account's own `currency` is null when it simply
   *  uses the base, so without this the amount label read "Betrag ()". */
  baseCurrency: string;
  busy?: boolean;
  error?: string | null;
  onSave: (id: string, patch: Partial<SpendingTransactionInput>) => void | Promise<void>;
  onClose: () => void;
}

export function TransactionEditDialog({
  transaction,
  accounts,
  categories,
  baseCurrency,
  busy,
  error,
  onSave,
  onClose,
}: TransactionEditDialogProps) {
  return (
    // Wide enough for the two-column grid; the category dropdown's options
    // carry a "group · name" label and need the room.
    <Modal open={transaction !== null} onClose={onClose} maxWidthClass="max-w-3xl">
      {transaction && (
        // Keyed on the row so opening another one re-seeds every field.
        <EditForm
          key={transaction.id}
          transaction={transaction}
          accounts={accounts}
          categories={categories}
          baseCurrency={baseCurrency}
          busy={busy}
          error={error}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function EditForm({
  transaction,
  accounts,
  categories,
  baseCurrency,
  busy,
  error,
  onSave,
  onClose,
}: Omit<TransactionEditDialogProps, "transaction"> & { transaction: SpendingTransaction }) {
  const { t } = useI18n();

  // The sign is a control of its own rather than something the user types into
  // the amount field, exactly like the quick-add form: `amount` is signed in
  // storage, but "-50" is not how anyone writes down a 50 euro expense.
  const [isIncome, setIsIncome] = useState(transaction.amount >= 0);
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [payee, setPayee] = useState(transaction.payee);
  const [date, setDate] = useState(transaction.date);
  const [accountId, setAccountId] = useState(transaction.accountId);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "");
  const [transferAccountId, setTransferAccountId] = useState(transaction.transferAccountId ?? "");
  const [note, setNote] = useState(transaction.note ?? "");

  // Amounts are in the ACCOUNT's native currency, so the label follows the
  // account picker rather than the profile base.
  const currency = accounts.find((a) => a.id === accountId)?.currency || baseCurrency;

  // A transfer already names where the money went, so the payee is optional
  // there and falls back to the target account: demanding a recipient for
  // "Umbuchung auf Hundekonto" asked a question the picker had answered.
  const transfer =
    transferAccountId && transferAccountId !== accountId ? transferAccountId : null;
  const transferName = accounts.find((a) => a.id === transfer)?.name ?? "";
  const effectivePayee = payee.trim() || transferName;

  function save() {
    const value = parseDecimal(amount);
    if (!effectivePayee || !Number.isFinite(value) || value <= 0 || !accountId) return;
    void onSave(transaction.id, {
      accountId,
      categoryId: categoryId || null,
      date,
      amount: isIncome ? Math.abs(value) : -Math.abs(value),
      payee: effectivePayee,
      note: note.trim() || null,
      transferAccountId: transfer,
    });
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("spending.edit.title")}</h2>
      {/* A booking a contract or a plan produced keeps saying so: the figures
          below are editable, its origin is not. */}
      {(transaction.recurringId || transaction.plannedId) && (
        <p className="mt-1 text-sm text-zinc-500">{t("spending.edit.originNote")}</p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">{t("spending.form.typeLabel")}</label>
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
          <label className="text-sm font-medium" htmlFor="edit-tx-amount">
            {t("spending.form.amountLabel", { currency })}
          </label>
          <input
            id="edit-tx-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
            placeholder="0"
            className={inputCls}
            data-private
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="edit-tx-payee">
            {t("spending.form.payeeLabel")}
          </label>
          <input
            id="edit-tx-payee"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            className={inputCls}
            data-private
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="edit-tx-date">
            {t("spending.form.dateLabel")}
          </label>
          <input
            id="edit-tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("spending.form.accountLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.form.accountLabel")}
            value={accountId}
            onChange={setAccountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
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
              ...categories.map((c) => ({ value: c.id, label: c.name, group: c.groupName })),
            ]}
          />
        </div>
        {/* Marking a booking as a transfer is what keeps a loan instalment out
            of the expense figures and moves the other account instead. */}
        <div>
          <label className="text-sm font-medium">{t("spending.edit.transferLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("spending.edit.transferLabel")}
            value={transferAccountId}
            onChange={setTransferAccountId}
            options={[
              { value: "", label: t("spending.edit.transferNone") },
              ...accounts
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
        <div>
          <label className="text-sm font-medium" htmlFor="edit-tx-note">
            {t("spending.form.noteLabel")}
          </label>
          <input
            id="edit-tx-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className={inputCls}
            data-private
          />
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex gap-2">
        <Button variant="primary" disabled={busy || !effectivePayee || !amount.trim()} onClick={save}>
          {t("spending.edit.save")}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </Card>
  );
}
