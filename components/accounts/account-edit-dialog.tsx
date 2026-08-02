"use client";

// Editor for an existing account's own master data (flag `accounts`): name,
// kind, currency, opening balance and opening date. Without this the figures
// typed once when adding an account were effectively write-once -- a mortgage
// entered with the wrong amount could only be deleted and re-created, which
// cascades its balance readings, spending transactions, planned cashflows and
// any goal link with it. Rides the same generic `updateAccount` patch on the
// store seam that DebtDetailsDialog uses for rate/minimum payment.

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import {
  ACCOUNT_KINDS,
  INTEREST_FREQUENCIES,
  LIABILITY_KINDS,
  type Account,
  type AccountKind,
  type InterestFrequency,
} from "@/lib/types";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { FormActions } from "@/components/ui/form-actions";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function AccountEditDialog({
  account,
  open,
  onClose,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
}) {
  const { data, updateAccount } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [name, setName] = useState(account.name);
  const [kind, setKind] = useState<AccountKind>(account.kind);
  const [currency, setCurrency] = useState(account.currency || base);
  const [opening, setOpening] = useState(String(account.openingBalance));
  const [openedOn, setOpenedOn] = useState(account.openedOn);
  // One rate field for both sides of the ledger: credit interest on an asset
  // account, the borrowing rate on a liability. What it MEANS follows from the
  // kind, which is picked right above it -- the debt terms used to live on
  // /debt behind a second dialog, which asked the user to set up an account in
  // one place and finish it in another.
  const [interestRate, setInterestRate] = useState(
    account.interestRate != null ? String(account.interestRate) : "",
  );
  const [interestFrequency, setInterestFrequency] = useState<InterestFrequency>(
    account.interestFrequency ?? "MONTHLY",
  );
  const [minPayment, setMinPayment] = useState(
    account.minPayment != null ? String(account.minPayment) : "",
  );
  const [rateFixedUntil, setRateFixedUntil] = useState(account.rateFixedUntil ?? "");
  const [followUpRate, setFollowUpRate] = useState(
    account.followUpRate != null ? String(account.followUpRate) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindLabel = (k: AccountKind) => t(`accounts.kind.${k}` as Parameters<typeof t>[0]);

  // A dated reading always wins over the opening balance (balanceSeries in
  // lib/finance/accounts.ts), so correcting the opening figure alone would look
  // like it did nothing on an account that already has readings. Say so.
  const hasReadings = data.accountBalances.some((b) => b.accountId === account.id);

  async function save() {
    const trimmed = name.trim();
    const openingVal = parseDecimal(opening);
    if (!trimmed || !openedOn) return;
    if (!Number.isFinite(openingVal)) {
      setError(t("common.invalidAmount"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cur = currency.trim().toUpperCase();
      const isLiability = LIABILITY_KINDS.includes(kind);
      const rate = interestRate.trim() ? parseDecimal(interestRate) : null;
      const payment = minPayment.trim() ? parseDecimal(minPayment) : null;
      const followUp = followUpRate.trim() ? parseDecimal(followUpRate) : null;
      if (
        (rate !== null && !Number.isFinite(rate)) ||
        (payment !== null && !Number.isFinite(payment)) ||
        (followUp !== null && !Number.isFinite(followUp))
      ) {
        setError(t("common.invalidAmount"));
        setBusy(false);
        return;
      }
      await updateAccount(account.id, {
        name: trimmed,
        kind,
        currency: !cur || cur === base ? null : cur,
        // Kind and liability-ness are one decision, exactly as in the add form.
        isLiability,
        openingBalance: openingVal,
        openedOn,
        interestRate: rate,
        // The instalment and the follow-up rate only mean something on a debt.
        ...(isLiability
          ? {
              interestFrequency: null,
              minPayment: payment,
              // A follow-up rate with no end date (or the other way round)
              // would silently do nothing, so an incomplete pair is no pair.
              rateFixedUntil: rateFixedUntil && followUp != null ? rateFixedUntil : null,
              followUpRate: rateFixedUntil && followUp != null ? followUp : null,
            }
          : { interestFrequency: rate ? interestFrequency : null }),
      });
      onClose();
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("accounts.edit.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <Card>
        <h2 className="text-lg font-semibold" data-private>
          {t("accounts.edit.title", { name: account.name })}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("accounts.edit.intro")}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="account-edit-name">
              {t("accounts.form.nameLabel")}
            </label>
            <input
              id="account-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              data-private
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("accounts.form.kindLabel")}</label>
            <SelectMenu
              className="mt-1 w-full"
              ariaLabel={t("accounts.form.kindLabel")}
              value={kind}
              onChange={(v) => setKind(v as AccountKind)}
              options={ACCOUNT_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="account-edit-currency">
              {t("accounts.form.currencyLabel")}
            </label>
            <input
              id="account-edit-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              placeholder={base}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="account-edit-opening">
              {t("accounts.form.openingLabel", { currency: currency.trim() || base })}
            </label>
            <input
              id="account-edit-opening"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="account-edit-opened">
              {t("accounts.form.openedLabel")}
            </label>
            <input
              id="account-edit-opened"
              type="date"
              value={openedOn}
              max={today()}
              onChange={(e) => setOpenedOn(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="account-edit-interest">
              {LIABILITY_KINDS.includes(kind)
                ? t("debt.details.rateLabel")
                : t("accounts.form.interestLabel")}
            </label>
            <input
              id="account-edit-interest"
              inputMode="decimal"
              value={interestRate}
              onChange={(e) => setInterestRate(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="0"
              className={inputCls}
            />
          </div>
          {LIABILITY_KINDS.includes(kind) && (
            <>
              <div>
                <label className="text-sm font-medium" htmlFor="account-edit-min-payment">
                  {t("debt.details.minPaymentLabel", { currency: currency || base })}
                </label>
                <input
                  id="account-edit-min-payment"
                  inputMode="decimal"
                  value={minPayment}
                  onChange={(e) => setMinPayment(stripLeadingZero(e.target.value))}
                  placeholder="0"
                  className={inputCls}
                  data-private
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="account-edit-rate-until">
                  {t("debt.details.rateFixedUntilLabel")}
                </label>
                <input
                  id="account-edit-rate-until"
                  type="date"
                  value={rateFixedUntil}
                  onChange={(e) => setRateFixedUntil(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="account-edit-follow-up">
                  {t("debt.details.followUpRateLabel")}
                </label>
                <input
                  id="account-edit-follow-up"
                  inputMode="decimal"
                  value={followUpRate}
                  onChange={(e) => setFollowUpRate(stripLeadingZero(e.target.value))}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            </>
          )}
          {!LIABILITY_KINDS.includes(kind) && (
            <>
              <div>
                <label className="text-sm font-medium">
                  {t("accounts.form.interestFrequencyLabel")}
                </label>
                <SelectMenu
                  className="mt-1 w-full"
                  ariaLabel={t("accounts.form.interestFrequencyLabel")}
                  value={interestFrequency}
                  onChange={(v) => setInterestFrequency(v as InterestFrequency)}
                  options={INTEREST_FREQUENCIES.map((f) => ({
                    value: f,
                    label: t(`cashInterest.freq.${f}` as Parameters<typeof t>[0]),
                  }))}
                />
              </div>
            </>
          )}
        </div>
        {!LIABILITY_KINDS.includes(kind) && interestRate.trim() !== "" && (
          <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.interestHint")}</p>
        )}

        {LIABILITY_KINDS.includes(kind) && (
          <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.liabilityHint")}</p>
        )}
        {hasReadings && <p className="mt-2 text-sm text-zinc-500">{t("accounts.edit.hasReadings")}</p>}
        <FormActions error={error}>
          <Button variant="secondary" onClick={onClose}>
            {t("tx.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim() || !openedOn}
            onClick={() => void save()}
          >
            {t("accounts.edit.save")}
          </Button>
        </FormActions>
      </Card>
    </Modal>
  );
}
