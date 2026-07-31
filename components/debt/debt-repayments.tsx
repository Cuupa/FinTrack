"use client";

// Planned one-off repayments (Sondertilgungen) as an input of the payoff plan,
// sitting next to the extra monthly payment (owner correction, round 27).
// Nothing here is booked: a repayment that actually happened is a transfer on
// the accounts page and lands in the balance by itself. This is the what-if
// lever the balance chart and "time to debt-free" react to.
//
// Storage is unchanged (`account_extra_repayments` via `setExtraRepayments`,
// replace-set per account); the target liability is simply chosen here instead
// of being implied by the dialog it used to live in.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";

export interface RepaymentDebt {
  id: string;
  name: string;
  /** The account's own currency -- amounts are stored natively. */
  currency: string;
}

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function DebtRepaymentsPlanner({ debts }: { debts: RepaymentDebt[] }) {
  const { data, setExtraRepayments } = usePortfolio();
  const { t } = useI18n();
  const todayIso = today();

  const [accountId, setAccountId] = useState(debts[0]?.id ?? "");
  const [date, setDate] = useState(todayIso);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A debt deleted while selected falls back to the first one, so the form
  // never targets an account that is gone.
  const target = debts.find((d) => d.id === accountId) ?? debts[0];
  const byId = useMemo(() => new Map(debts.map((d) => [d.id, d])), [debts]);

  const planned = useMemo(
    () =>
      data.extraRepayments
        .filter((r) => byId.has(r.accountId))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [data.extraRepayments, byId],
  );

  /** Replace-set: `next` is that account's whole set of planned lump sums. */
  async function persist(id: string, next: { date: string; amount: number }[]) {
    setBusy(true);
    setError(null);
    try {
      await setExtraRepayments(id, next);
      return true;
    } catch (err) {
      const reason = isStorageFullError(err) ? null : storeErrorReason(err);
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : reason
            ? `${t("debt.repayments.error")} ${reason}`
            : t("debt.repayments.error"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function otherRepayments(id: string, dropDate?: string) {
    return data.extraRepayments
      .filter((r) => r.accountId === id && r.date !== dropDate)
      .map((r) => ({ date: r.date, amount: r.amount }));
  }

  async function add() {
    if (!target || !date) return;
    const value = parseDecimal(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t("common.invalidAmount"));
      return;
    }
    // Upsert by date: a second amount on a date the debt already has replaces
    // it instead of quietly stacking two lump sums.
    const next = otherRepayments(target.id, date);
    next.push({ date, amount: value });
    if (await persist(target.id, next)) setAmount("");
  }

  async function remove(id: string, dropDate: string) {
    await persist(id, otherRepayments(id, dropDate));
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
              if (e.key === "Enter") void add();
            }}
            placeholder="0"
            className={inputCls}
            data-private
          />
        </div>
        <Button
          variant="secondary"
          disabled={busy || !date || !amount.trim()}
          onClick={() => void add()}
        >
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
                  <button
                    type="button"
                    onClick={() => void remove(r.accountId, r.date)}
                    disabled={busy}
                    aria-label={t("debt.repayments.remove")}
                    className="text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
