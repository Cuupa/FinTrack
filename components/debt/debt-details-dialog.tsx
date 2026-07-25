"use client";

// Interest-rate + minimum-payment editor for one liability account (ROADMAP
// #9, flag `debtPayoff`). Both fields are optional on the account itself
// (lib/types.ts) -- this dialog is the only place they're entered/edited,
// via the generic `updateAccount` patch on the store seam.

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { Account } from "@/lib/types";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

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
  const { updateAccount } = usePortfolio();
  const { t } = useI18n();

  const [rate, setRate] = useState(account.interestRate != null ? String(account.interestRate) : "");
  const [minPayment, setMinPayment] = useState(
    account.minPayment != null ? String(account.minPayment) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const rateVal = rate.trim() ? parseDecimal(rate) : null;
    const paymentVal = minPayment.trim() ? parseDecimal(minPayment) : null;
    if (rateVal != null && !Number.isFinite(rateVal)) return;
    if (paymentVal != null && !Number.isFinite(paymentVal)) return;
    setBusy(true);
    setError(null);
    try {
      await updateAccount(account.id, { interestRate: rateVal, minPayment: paymentVal });
      onClose();
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("debt.details.error"));
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
              {t("debt.details.minPaymentLabel", { currency: account.currency || "" })}
            </label>
            <input
              id="debt-min-payment"
              inputMode="decimal"
              value={minPayment}
              onChange={(e) => setMinPayment(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

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
