"use client";

// The savings-plan create/edit form, shared by the dashboard's savings-plans
// card and the asset-detail page's "new plan for this asset" entry point
// (fixedAsset). See components/dashboard/savings-plans-card.tsx for the rest
// of the savings-plans feature (due-execution review, list, pause/delete).

import { useState, type ReactNode } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";
import { today } from "@/lib/finance/dates";
import {
  assetPriceKey,
  SAVINGS_PLAN_INTERVALS,
  type Asset,
  type SavingsPlan,
  type SavingsPlanInterval,
} from "@/lib/types";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import { useFormTouched, missingFieldCls, missingLabelCls } from "@/lib/forms/required";
import { isStorageFullError } from "@/lib/store/errors";

export const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export const INTERVAL_KEY: Record<SavingsPlanInterval, MessageKey> = {
  WEEKLY: "sp.weekly",
  MONTHLY: "sp.monthly",
  QUARTERLY: "sp.quarterly",
};

/** The fields the form edits — shared by create (wrapped with active/lastRunDate) and edit (patched as-is, never touching active/lastRunDate). */
export type PlanFormValues = Pick<
  SavingsPlan,
  "assetId" | "portfolioId" | "amount" | "interval" | "bookingType" | "startDate"
>;

export function PlanForm({
  plan,
  fixedAsset,
  onSubmit,
  onDone,
  limitReached,
}: {
  /** Present in edit mode; prefills the form and switches the submit label/copy. */
  plan?: SavingsPlan;
  /** When set, the plan is scoped to this asset: the asset picker is replaced
   * by a read-only row and the amount currency always comes from this asset
   * (the asset-detail page's entry point — see components/assets/asset-detail.tsx). */
  fixedAsset?: Asset;
  onSubmit: (values: PlanFormValues) => Promise<void>;
  onDone: () => void;
  /** Plan-limit cap (MONETIZATION.md Phase 4): when set, submit is blocked
   *  and this hint renders instead. Only applied in create mode (`plan`
   *  absent) — editing/pausing/deleting an existing plan is never blocked
   *  (grandfathering: the cap only stops adding new rows). */
  limitReached?: ReactNode;
}) {
  const { data, portfolios, selectedPortfolioIds, addAsset } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;

  // Securities book recurring BUYs at the market price; CASH positions book
  // recurring deposits at price 1 (e.g. vermögenswirksame Leistungen), so
  // every asset type is eligible.
  const eligible = data.assets;

  const [assetId, setAssetId] = useState(plan?.assetId ?? fixedAsset?.id ?? eligible[0]?.id ?? "");
  const [portfolioId, setPortfolioId] = useState(
    plan?.portfolioId ?? selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [amount, setAmount] = useState(plan ? String(plan.amount) : "");
  const [frequency, setFrequency] = useState<SavingsPlanInterval>(plan?.interval ?? "MONTHLY");
  // BUY = own money (cost basis as usual); BOOKING = free external inflow
  // (Einbuchung, e.g. employer-paid VL) credited at zero cost.
  const [bookingType, setBookingType] = useState<"BUY" | "BOOKING">(plan?.bookingType ?? "BUY");
  const [startDate, setStartDate] = useState(plan?.startDate ?? today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline "add a new asset" row, revealed from the asset SelectMenu's
  // "+ New asset…" footer button — mirrors the watchlist card's resolution
  // (catalog first, then /api/lookup), but creates a portfolio asset (no
  // transaction booked; the plan itself will generate BUYs when due). Not
  // reachable in fixedAsset mode (no asset picker there).
  const [addingAsset, setAddingAsset] = useState(false);
  const [newAssetQuery, setNewAssetQuery] = useState("");
  const [newAssetBusy, setNewAssetBusy] = useState(false);
  const [newAssetError, setNewAssetError] = useState<string | null>(null);

  const asset = fixedAsset ?? eligible.find((a) => a.id === assetId);
  const cur = fixedAsset?.currency ?? asset?.currency ?? base;

  const { touched, touch } = useFormTouched();
  // Presence-only gating for the "Create" button — mirrors handleSubmit's checks.
  const assetMissing = fixedAsset ? false : !assetId;
  const amountMissing = !amount.trim();
  const formIncomplete = assetMissing || amountMissing;
  const blockedByLimit = !plan && limitReached != null;

  function openAddAsset() {
    setNewAssetError(null);
    setNewAssetQuery("");
    setAddingAsset(true);
  }

  function closeAddAsset() {
    setAddingAsset(false);
    setNewAssetQuery("");
    setNewAssetError(null);
  }

  async function handleResolveNewAsset() {
    const q = newAssetQuery.trim();
    if (!q) return;
    setNewAssetError(null);
    setNewAssetBusy(true);
    try {
      const m = await resolveInstrumentByQuery(q);
      if (!m) {
        setNewAssetError(t("watchlist.notFound"));
        return;
      }
      // Plans are securities-only — shouldn't happen from a real lookup, but
      // guard the same way `eligible` filters existing assets.
      if (m.type === "CASH") {
        setNewAssetError(t("sp.newAssetCash"));
        return;
      }
      const input: Omit<Asset, "id"> = { ...m, notes: null };
      const key = assetPriceKey(input);
      const existing = data.assets.find((a) => assetPriceKey(a) === key);
      if (existing) {
        setAssetId(existing.id);
        closeAddAsset();
        return;
      }
      const created = await addAsset(input);
      setAssetId(created.id);
      closeAddAsset();
    } catch (err) {
      setNewAssetError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : err instanceof Error
            ? err.message
            : t("watchlist.notFound"),
      );
    } finally {
      setNewAssetBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (blockedByLimit) return;
    const amt = parseDecimal(amount);
    if (!assetId) {
      setError(t("sp.errAsset"));
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t("sp.errAmount"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        assetId,
        portfolioId: portfolioId || portfolios[0]?.id || "",
        amount: amt,
        interval: frequency,
        bookingType,
        startDate,
      });
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : err instanceof Error
            ? err.message
            : t("sp.applyError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className={missingLabelCls(assetMissing, touched)}>{t("sp.asset")}</span>
          {fixedAsset ? (
            <p className="text-sm">{fixedAsset.name}</p>
          ) : (
            <>
              <SelectMenu
                value={assetId}
                ariaLabel={t("sp.asset")}
                onChange={(v) => {
                  touch();
                  setAssetId(v);
                }}
                options={eligible.map((a) => ({
                  value: a.id,
                  label: a.name,
                  keywords: [a.isin, a.wkn, a.symbol].filter((v): v is string => !!v),
                }))}
                searchable
                footer={(close) => (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      openAddAsset();
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                  >
                    {t("sp.newAsset")}
                  </button>
                )}
              />
              {addingAsset && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  <input
                    type="text"
                    autoFocus
                    value={newAssetQuery}
                    onChange={(e) => setNewAssetQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleResolveNewAsset();
                      }
                      if (e.key === "Escape") closeAddAsset();
                    }}
                    placeholder={t("watchlist.placeholder")}
                    aria-label={t("watchlist.placeholder")}
                    className={`${inputCls} flex-1`}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={newAssetBusy || !newAssetQuery.trim()}
                    onClick={() => void handleResolveNewAsset()}
                  >
                    {newAssetBusy ? "…" : t("watchlist.add")}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={closeAddAsset}>
                    {t("tx.cancel")}
                  </Button>
                </div>
              )}
              {newAssetError && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{newAssetError}</p>
              )}
            </>
          )}
          {asset?.type === "CASH" && (
            <p className="mt-1 text-xs text-zinc-500">{t("sp.cashPlanHint")}</p>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t("sp.amount")}</span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => {
                touch();
                setAmount(stripLeadingZero(e.target.value));
              }}
              onBlur={touch}
              className={`${inputCls} pr-12${missingFieldCls(amountMissing, touched)}`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              {cur}
            </span>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t("sp.interval")}</span>
          <SelectMenu
            value={frequency}
            ariaLabel={t("sp.interval")}
            onChange={(v) => setFrequency(v as SavingsPlanInterval)}
            options={SAVINGS_PLAN_INTERVALS.map((i) => ({
              value: i,
              label: t(INTERVAL_KEY[i]),
            }))}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t("sp.start")}</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
          />
        </label>
        <div className="col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">
            {t("sp.bookingType")}
          </span>
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
            {(["BUY", "BOOKING"] as const).map((bt) => (
              <button
                key={bt}
                type="button"
                onClick={() => setBookingType(bt)}
                aria-pressed={bookingType === bt}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  bookingType === bt
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {t(bt === "BUY" ? "tx.buy" : "tx.booking")}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {t(bookingType === "BOOKING" ? "sp.bookingTypeBookingHint" : "sp.bookingTypeBuyHint")}
          </p>
        </div>
        {portfolios.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">{t("tx.portfolio")}</span>
            <SelectMenu
              value={portfolioId}
              ariaLabel={t("tx.portfolio")}
              onChange={setPortfolioId}
              options={portfolios.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {formIncomplete && touched && (
        <p className="text-xs text-zinc-500">{t("form.missingFields")}</p>
      )}
      {blockedByLimit && <p className="text-sm text-zinc-500">{limitReached}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onDone}>
          {t("tx.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={busy || formIncomplete || blockedByLimit}
        >
          {busy ? t("sp.applying") : plan ? t("sp.save") : t("sp.create")}
        </Button>
      </div>
    </form>
  );
}
