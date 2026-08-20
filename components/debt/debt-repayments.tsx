"use client";

// Planned one-off repayments (Sondertilgungen) as an input of the payoff plan,
// sitting next to the extra monthly payment.
//
// LIVE, never persisted (owner rule, round 27): this is the same kind of lever
// as the extra monthly payment right above it -- you type a number, the chart
// and "time to debt-free" answer, and nothing is written anywhere. Storing it
// made a what-if look like a commitment, and the plan is not a record of what
// happened: a repayment actually made is a transfer on the accounts page and
// lands in the balance by itself.
//
// So the state lives in `DebtView` (one array, lifted only so the plan can
// read it) and dies with the page. No store, no save, no save error.

import { useMemo, useState } from "react";
import { today } from "@/lib/finance/dates";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { FormActions } from "@/components/ui/form-actions";
import { useI18n } from "@/lib/i18n/i18n-context";
import { DeleteAction, RowActions } from "@/components/ui/row-actions";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";

export interface RepaymentDebt {
  id: string;
  name: string;
  /** The account's own currency -- amounts are entered natively. */
  currency: string;
}

/** One planned lump sum, in its account's own currency. */
export interface PlannedRepayment {
  accountId: string;
  /** YYYY-MM-DD the lump sum is paid. */
  date: string;
  amount: number;
}

export function DebtRepaymentsPlanner({
  debts,
  value,
  onChange,
}: {
  debts: RepaymentDebt[];
  value: PlannedRepayment[];
  onChange: (next: PlannedRepayment[]) => void;
}) {
  const { t } = useI18n();
  const todayIso = today();

  // The form lives in a dialog opened from "Add repayment" (Spec §12.1): a
  // what-if input is not a permanent empty row on the page.
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(debts[0]?.id ?? "");
  const [date, setDate] = useState(todayIso);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A debt deleted while selected falls back to the first one, so the form
  // never targets an account that is gone.
  const target = debts.find((d) => d.id === accountId) ?? debts[0];
  const byId = useMemo(() => new Map(debts.map((d) => [d.id, d])), [debts]);

  const sort = useSort<"date" | "account" | "amount">("date");
  const planned = useMemo(
    () =>
      sort.apply(
        value.filter((r) => byId.has(r.accountId)),
        (r, key) =>
          key === "date" ? r.date : key === "amount" ? r.amount : (byId.get(r.accountId)?.name ?? ""),
      ),
    [value, byId, sort],
  );

  function add() {
    if (!target || !date) return;
    const parsed = parseDecimal(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("common.invalidAmount"));
      return;
    }
    setError(null);
    // Upsert by date: a second amount on a date the debt already has replaces
    // it instead of quietly stacking two lump sums.
    onChange([
      ...value.filter((r) => !(r.accountId === target.id && r.date === date)),
      { accountId: target.id, date, amount: parsed },
    ]);
    setAmount("");
    setOpen(false);
  }

  function openDialog() {
    setError(null);
    setAmount("");
    setDate(todayIso);
    setOpen(true);
  }

  function remove(id: string, dropDate: string) {
    onChange(value.filter((r) => !(r.accountId === id && r.date === dropDate)));
  }

  if (debts.length === 0) return null;

  return (
    <div data-tour="debt-repayments">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("debt.repayments.title")}</h3>
        <Button variant="secondary" size="sm" onClick={openDialog}>
          {t("debt.repayments.add")}
        </Button>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("debt.repayments.intro")}</p>

      {planned.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("debt.repayments.empty")}</p>
      ) : (
        <Table className="mt-3">
          <Thead>
            <Th sort={sort.sort} sortKey="date" onSort={sort.toggle}>
              {t("debt.repayments.dateLabel")}
            </Th>
            <Th sort={sort.sort} sortKey="account" onSort={sort.toggle}>
              {t("debt.repayments.accountLabel")}
            </Th>
            <Th align="right" sort={sort.sort} sortKey="amount" onSort={sort.toggle}>
              {t("tx.amount")}
            </Th>
            <Th />
          </Thead>
          <Tbody>
            {planned.map((r) => (
              <Tr key={`${r.accountId}-${r.date}`}>
                <Td>{formatDate(r.date)}</Td>
                <Td data-private>{byId.get(r.accountId)?.name}</Td>
                <Td align="right" className="tabular-nums" data-private>
                  {formatCurrency(r.amount, byId.get(r.accountId)?.currency ?? "")}
                </Td>
                <Td align="right">
                  <RowActions>
                    <DeleteAction
                      label={t("debt.repayments.remove")}
                      onClick={() => remove(r.accountId, r.date)}
                    />
                  </RowActions>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal open={open} onClose={() => setOpen(false)} maxWidthClass="max-w-lg">
        <Card>
          <h2 className="text-lg font-semibold">{t("debt.repayments.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("debt.repayments.intro")}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t("debt.repayments.accountLabel")} className="sm:col-span-2">
              <SelectMenu
                className="mt-1 w-full"
                ariaLabel={t("debt.repayments.accountLabel")}
                value={target?.id ?? ""}
                onChange={setAccountId}
                options={debts.map((d) => ({ value: d.id, label: d.name }))}
              />
            </Field>
            <Field label={t("debt.repayments.dateLabel")} htmlFor="debt-repay-date">
              <Input
                id="debt-repay-date"
                type="date"
                value={date}
                min={todayIso}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field
              label={t("debt.repayments.amountLabel", { currency: target?.currency ?? "" })}
              htmlFor="debt-repay-amount"
            >
              <Input
                id="debt-repay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
                placeholder="0"
                data-private={amount !== "" ? "" : undefined}
                autoFocus
              />
            </Field>
          </div>

          <FormActions error={error}>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!date || !amount.trim()} onClick={add}>
              {t("debt.repayments.add")}
            </Button>
          </FormActions>
        </Card>
      </Modal>
    </div>
  );
}
