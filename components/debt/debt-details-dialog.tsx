"use client";

// Interest-rate + minimum-payment editor for one liability account (ROADMAP
// #9, flag `debtPayoff`). Every field is optional on the account itself
// (lib/types.ts) -- this dialog is the only place they're entered/edited,
// via the generic `updateAccount` patch on the store seam.
//
// It also holds the planned one-off repayments (Sondertilgungen): dated lump
// sums the schedule charges on top of the instalment. They live here rather
// than on the accounts page because they are a payoff-planning input, not a
// balance the bank ever reports, and they ride the same replace-set seam as
// the dated balance readings (`setExtraRepayments`).
//
// The fixed-rate period is TWO fields, not a replacement for the rate: the
// user must be able to say "4.17% until 2036, then an assumed 5%" without
// overwriting the rate that is actually being charged today (owner rule,
// round 26). `accountRateSteps` turns the pair into the schedule the
// amortisation runs on.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { Account } from "@/lib/types";
import { today } from "@/lib/finance/dates";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError, storeErrorReason } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function DebtDetailsDialog({
  account,
  open,
  onClose,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
}) {
  const { data, updateAccount, setExtraRepayments } = usePortfolio();
  const { t } = useI18n();
  const cur = account.currency || data.profile.currency;
  const todayIso = today();

  const repayments = useMemo(
    () =>
      data.extraRepayments
        .filter((r) => r.accountId === account.id)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [data.extraRepayments, account.id],
  );

  const [repayDate, setRepayDate] = useState(todayIso);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayBusy, setRepayBusy] = useState(false);
  const [repayError, setRepayError] = useState<string | null>(null);

  // Replace-set: `next` is this account's whole set of planned lump sums.
  async function persistRepayments(next: { date: string; amount: number }[]) {
    setRepayBusy(true);
    setRepayError(null);
    try {
      await setExtraRepayments(account.id, next);
      return true;
    } catch (err) {
      const reason = isStorageFullError(err) ? null : storeErrorReason(err);
      setRepayError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : reason
            ? `${t("debt.repayments.error")} ${reason}`
            : t("debt.repayments.error"),
      );
      return false;
    } finally {
      setRepayBusy(false);
    }
  }

  async function addRepayment() {
    const amount = parseDecimal(repayAmount);
    if (!repayDate) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      setRepayError(t("common.invalidAmount"));
      return;
    }
    // Upsert by date, like the balance editor: a second amount on a date it
    // already has replaces it instead of quietly stacking two lump sums.
    const next = repayments
      .filter((r) => r.date !== repayDate)
      .map((r) => ({ date: r.date, amount: r.amount }));
    next.push({ date: repayDate, amount });
    if (await persistRepayments(next)) setRepayAmount("");
  }

  async function removeRepayment(date: string) {
    await persistRepayments(
      repayments.filter((r) => r.date !== date).map((r) => ({ date: r.date, amount: r.amount })),
    );
  }

  const [rate, setRate] = useState(account.interestRate != null ? String(account.interestRate) : "");
  const [minPayment, setMinPayment] = useState(
    account.minPayment != null ? String(account.minPayment) : "",
  );
  const [rateFixedUntil, setRateFixedUntil] = useState(account.rateFixedUntil ?? "");
  const [followUpRate, setFollowUpRate] = useState(
    account.followUpRate != null ? String(account.followUpRate) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const rateVal = rate.trim() ? parseDecimal(rate) : null;
    const paymentVal = minPayment.trim() ? parseDecimal(minPayment) : null;
    const followUpVal = followUpRate.trim() ? parseDecimal(followUpRate) : null;
    // Same rule as the accounts forms: an unparseable figure gets a message,
    // never a silent no-op on the save button.
    if (
      (rateVal != null && !Number.isFinite(rateVal)) ||
      (paymentVal != null && !Number.isFinite(paymentVal)) ||
      (followUpVal != null && !Number.isFinite(followUpVal))
    ) {
      setError(t("common.invalidAmount"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateAccount(account.id, {
        interestRate: rateVal,
        minPayment: paymentVal,
        // A follow-up rate with no end date (or the other way round) would
        // silently do nothing, so an incomplete pair is stored as no pair.
        rateFixedUntil: rateFixedUntil && followUpVal != null ? rateFixedUntil : null,
        followUpRate: rateFixedUntil && followUpVal != null ? followUpVal : null,
      });
      onClose();
    } catch (err) {
      // Show the database's own reason rather than "try again" forever.
      const reason = isStorageFullError(err) ? null : storeErrorReason(err);
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : reason
            ? `${t("debt.details.error")} ${reason}`
            : t("debt.details.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <Card>
        <h2 className="text-lg font-semibold" data-private>
          {t("debt.details.title", { name: account.name })}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("debt.details.intro")}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="debt-rate">
              {t("debt.details.rateLabel")}
            </label>
            <input
              id="debt-rate"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(stripLeadingZero(e.target.value))}
              placeholder="0"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="debt-min-payment">
              {/* `cur`, not account.currency: an account on the base currency
                  stores null there, which rendered an empty "(...)". */}
              {t("debt.details.minPaymentLabel", { currency: cur })}
            </label>
            <input
              id="debt-min-payment"
              inputMode="decimal"
              value={minPayment}
              onChange={(e) => setMinPayment(stripLeadingZero(e.target.value))}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
        </div>

        <h3 className="mt-6 text-sm font-semibold">{t("debt.details.rateSectionTitle")}</h3>
        <p className="mt-1 text-sm text-zinc-500">{t("debt.details.followUpHint")}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="debt-rate-fixed-until">
              {t("debt.details.rateFixedUntilLabel")}
            </label>
            <input
              id="debt-rate-fixed-until"
              type="date"
              value={rateFixedUntil}
              onChange={(e) => setRateFixedUntil(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="debt-follow-up-rate">
              {t("debt.details.followUpRateLabel")}
            </label>
            <input
              id="debt-follow-up-rate"
              inputMode="decimal"
              value={followUpRate}
              onChange={(e) => setFollowUpRate(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="0"
              className={inputCls}
            />
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <h3 className="mt-6 text-sm font-semibold">{t("debt.repayments.title")}</h3>
        <p className="mt-1 text-sm text-zinc-500">{t("debt.repayments.intro")}</p>

        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="text-sm font-medium" htmlFor="debt-repay-date">
              {t("debt.repayments.dateLabel")}
            </label>
            <input
              id="debt-repay-date"
              type="date"
              value={repayDate}
              min={todayIso}
              onChange={(e) => setRepayDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="debt-repay-amount">
              {t("debt.repayments.amountLabel", { currency: cur })}
            </label>
            <input
              id="debt-repay-amount"
              inputMode="decimal"
              value={repayAmount}
              onChange={(e) => setRepayAmount(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addRepayment();
              }}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
          <Button
            variant="secondary"
            disabled={repayBusy || !repayDate || !repayAmount.trim()}
            onClick={() => void addRepayment()}
          >
            {t("debt.repayments.add")}
          </Button>
        </div>

        {repayError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{repayError}</p>}

        {repayments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("debt.repayments.empty")}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {repayments.map((r) => (
                <tr
                  key={r.date}
                  className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-3 py-2">{formatDate(r.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-private>
                    {formatCurrency(r.amount, cur)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void removeRepayment(r.date)}
                      disabled={repayBusy}
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

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("tx.cancel")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {t("debt.details.save")}
          </Button>
        </div>
      </Card>
    </Modal>
  );
}
