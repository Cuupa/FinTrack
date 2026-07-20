"use client";

// Interest-bearing cash (COMPETITION.md F7): configure an annual rate +
// compounding frequency on a CASH asset, then review and book the interest
// that has accrued. Accrual math is pure (lib/finance/cash-interest.ts); this
// component only edits the config through the store seam and materializes due
// credits as INTEREST transactions after an explicit review, mirroring the
// savings-plan review-before-book pattern. Gated by the `cashInterest` flag at
// the call site (asset-detail.tsx).

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { dueInterest, nextInterestDate } from "@/lib/finance/cash-interest";
import { today } from "@/lib/finance/dates";
import { INTEREST_FREQUENCIES, type Asset, type InterestFrequency, type Transaction } from "@/lib/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function CashInterestSection({ asset, txs }: { asset: Asset; txs: Transaction[] }) {
  const { data, updateAsset, addTransaction } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;
  const cur = asset.currency || base;
  const todayISO = today();

  // Config form state, seeded from the asset. A blank/zero rate turns interest
  // off (dueInterest ignores a null/<=0 rate).
  const [rate, setRate] = useState(asset.interestRate != null ? String(asset.interestRate) : "");
  const [freq, setFreq] = useState<InterestFrequency>(asset.interestFrequency ?? "MONTHLY");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedRate = parseDecimal(rate);
  const nextRate = rate.trim() === "" || !Number.isFinite(parsedRate) || parsedRate <= 0 ? null : parsedRate;
  const dirty = nextRate !== (asset.interestRate ?? null) || freq !== (asset.interestFrequency ?? "MONTHLY");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateAsset(asset.id, {
        interestRate: nextRate,
        // Keep a frequency on record even when the rate is cleared, so
        // re-enabling later restores the last choice.
        interestFrequency: freq,
      });
      setSaved(true);
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("cashInterest.error"));
    } finally {
      setSaving(false);
    }
  }

  // Due credits (recomputed as transactions land after booking).
  const due = useMemo(() => dueInterest(asset, txs, todayISO), [asset, txs, todayISO]);
  const dueTotal = useMemo(() => round2(due.reduce((s, d) => s + d.amount, 0)), [due]);
  const next = nextInterestDate(asset, txs, todayISO);

  const [reviewing, setReviewing] = useState(false);
  const [rowEdits, setRowEdits] = useState<Map<string, string>>(new Map());
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  function openReview() {
    setRowEdits(new Map());
    setBookError(null);
    setReviewing(true);
  }
  function closeReview() {
    setReviewing(false);
    setRowEdits(new Map());
    setBookError(null);
  }

  const rows = useMemo(
    () =>
      due.map((d) => {
        const override = rowEdits.get(d.date);
        const amount = override !== undefined ? parseDecimal(override) : d.amount;
        return { date: d.date, input: override ?? String(d.amount), amount };
      }),
    [due, rowEdits],
  );
  const hasInvalidRow = rows.some((r) => !Number.isFinite(r.amount) || r.amount <= 0);

  async function book() {
    setBooking(true);
    setBookError(null);
    try {
      // The asset's transactions all sit in one portfolio (a cash account is a
      // single position); post the interest there.
      const portfolioId = txs[0]?.portfolioId ?? data.portfolios[0]?.id ?? "";
      for (const r of rows) {
        await addTransaction({
          assetId: asset.id,
          portfolioId,
          type: "INTEREST",
          quantity: round2(r.amount),
          price: 1,
          fee: 0,
          tax: 0,
          date: `${r.date}T00:00:00`,
        });
      }
      closeReview();
    } catch (err) {
      setBookError(isStorageFullError(err) ? t("common.storageFull") : t("cashInterest.error"));
    } finally {
      setBooking(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("cashInterest.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("cashInterest.intro")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="interest-rate">
            {t("cashInterest.rateLabel")}
          </label>
          <input
            id="interest-rate"
            inputMode="decimal"
            value={rate}
            onChange={(e) => {
              setRate(stripLeadingZero(e.target.value));
              setSaved(false);
            }}
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium">{t("cashInterest.frequencyLabel")}</label>
          <div className="mt-1">
            <SelectMenu
              value={freq}
              ariaLabel={t("cashInterest.frequencyLabel")}
              onChange={(v) => {
                setFreq(v as InterestFrequency);
                setSaved(false);
              }}
              options={INTEREST_FREQUENCIES.map((f) => ({
                value: f,
                label: t(`cashInterest.freq.${f}`),
              }))}
            />
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs text-zinc-500">{t("cashInterest.disable")}</p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          {t("cashInterest.save")}
        </Button>
        {saved && !dirty && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">{t("cashInterest.saved")}</span>
        )}
      </div>

      {due.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-sm text-amber-800 dark:text-amber-300" data-private>
            {t("cashInterest.due", { count: due.length, total: formatCurrency(dueTotal, cur) })}
          </span>
          <Button size="sm" variant="primary" onClick={openReview}>
            {t("cashInterest.review")}
          </Button>
        </div>
      ) : (
        nextRate != null &&
        next && <p className="mt-4 text-sm text-zinc-500">{t("cashInterest.next", { date: formatDate(next) })}</p>
      )}

      <Modal
        open={reviewing}
        onClose={() => {
          if (!booking) closeReview();
        }}
      >
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{t("cashInterest.modalTitle")}</h3>
          <p className="text-sm text-zinc-500">{t("cashInterest.modalHint")}</p>
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.date}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
              >
                <span className="text-sm">{formatDate(r.date)}</span>
                <label className="flex items-center gap-2 text-sm text-zinc-500">
                  {t("cashInterest.amount")}
                  <input
                    inputMode="decimal"
                    aria-label={t("cashInterest.amount")}
                    value={r.input}
                    onChange={(e) => {
                      const v = stripLeadingZero(e.target.value);
                      setRowEdits((prev) => {
                        const next = new Map(prev);
                        next.set(r.date, v);
                        return next;
                      });
                    }}
                    className="w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    data-private
                  />
                </label>
              </div>
            ))}
          </div>
          {bookError && <p className="text-sm text-red-600 dark:text-red-400">{bookError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={booking} onClick={closeReview}>
              {t("tx.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={booking || rows.length === 0 || hasInvalidRow}
              onClick={() => void book()}
            >
              {t("cashInterest.bookAll", { count: rows.length })}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
