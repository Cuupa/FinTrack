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
import { Button } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { DeleteAction, RowActions } from "@/components/ui/row-actions";

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

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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

  const [accountId, setAccountId] = useState(debts[0]?.id ?? "");
  const [date, setDate] = useState(todayIso);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A debt deleted while selected falls back to the first one, so the form
  // never targets an account that is gone.
  const target = debts.find((d) => d.id === accountId) ?? debts[0];
  const byId = useMemo(() => new Map(debts.map((d) => [d.id, d])), [debts]);

  const planned = useMemo(
    () =>
      value
        .filter((r) => byId.has(r.accountId))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [value, byId],
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
  }

  function remove(id: string, dropDate: string) {
    onChange(value.filter((r) => !(r.accountId === id && r.date === dropDate)));
  }

  if (debts.length === 0) return null;

  return (
    <div data-tour="debt-repayments">
      <h3 className="text-sm font-semibold">{t("debt.repayments.title")}</h3>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("debt.repayments.intro")}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label className="text-sm font-medium">{t("debt.repayments.accountLabel")}</label>
          <SelectMenu
            className="mt-1 w-full"
            ariaLabel={t("debt.repayments.accountLabel")}
            value={target?.id ?? ""}
            onChange={setAccountId}
            options={debts.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="debt-repay-date">
            {t("debt.repayments.dateLabel")}
          </label>
          <input
            id="debt-repay-date"
            type="date"
            value={date}
            min={todayIso}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="debt-repay-amount">
            {t("debt.repayments.amountLabel", { currency: target?.currency ?? "" })}
          </label>
          <input
            id="debt-repay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="0"
            className={inputCls}
            data-private
          />
        </div>
        <Button variant="secondary" disabled={!date || !amount.trim()} onClick={add}>
          {t("debt.repayments.add")}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {planned.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("debt.repayments.empty")}</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <tbody>
            {planned.map((r) => (
              <tr
                key={`${r.accountId}-${r.date}`}
                className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
              >
                <td className="px-3 py-2">{formatDate(r.date)}</td>
                <td className="px-3 py-2" data-private>
                  {byId.get(r.accountId)?.name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" data-private>
                  {formatCurrency(r.amount, byId.get(r.accountId)?.currency ?? "")}
                </td>
                <td className="px-3 py-2 text-right">
                  <RowActions>
                    <DeleteAction
                      label={t("debt.repayments.remove")}
                      onClick={() => remove(r.accountId, r.date)}
                    />
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
