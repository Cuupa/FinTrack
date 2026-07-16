"use client";

// Savings plans (Sparpläne): recurring buy rules managed on the dashboard.
// Due occurrences never post silently — they're listed in a review dialog
// (date, price, resulting quantity) and only an explicit confirm materializes
// them as ordinary BUY transactions, advancing each plan's lastRunDate.
// Gated by the `savingsPlans` feature flag — renders nothing when disabled.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";
import { dueOccurrences, nextOccurrence } from "@/lib/finance/savings-plans";
import { savingsPlanFee } from "@/lib/finance/fees";
import { today } from "@/lib/finance/dates";
import { priceOn, quoteItemFor } from "@/lib/finance/prices";
import { priceAtWithHeadTolerance } from "@/lib/history/history";
import { useHistory } from "@/lib/history/use-history";
import {
  assetPriceKey,
  SAVINGS_PLAN_INTERVALS,
  type Asset,
  type SavingsPlan,
  type SavingsPlanInterval,
} from "@/lib/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";
import { useFormTouched, missingFieldCls, missingLabelCls } from "@/lib/forms/required";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

const rowInputCls =
  "w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

/** Round to a fixed number of decimals (banker's-rounding-free, plain half-up). */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function rowKey(planId: string, date: string): string {
  return `${planId}:${date}`;
}

const INTERVAL_KEY: Record<SavingsPlanInterval, MessageKey> = {
  WEEKLY: "sp.weekly",
  MONTHLY: "sp.monthly",
  QUARTERLY: "sp.quarterly",
};

interface DueRow {
  plan: SavingsPlan;
  asset: Asset;
  date: string;
  price: number;
  synthetic: boolean;
  /** The plan's portfolio fee, prefilled into the fee input below. */
  feeDefault: number;
}

/** A user override for a single due row's price, quantity and/or fee input. */
interface RowEdit {
  price?: string;
  qty?: string;
  fee?: string;
}

interface EffectiveRow {
  /** Text shown in the price input. */
  priceInput: string;
  /** Text shown in the qty input. */
  qtyInput: string;
  /** Text shown in the fee input. */
  feeInput: string;
  /** Parsed price used for validation/booking. */
  effectivePrice: number;
  /** Parsed quantity used for validation/booking. */
  effectiveQty: number;
  /** Parsed fee used for booking (falls back to 0 when unparseable). */
  effectiveFee: number;
  /** Value shown in the "value at buy" column. */
  amount: number;
  /** Whether the user touched any field. */
  edited: boolean;
}

/**
 * Derives the displayed/effective price, qty, fee and amount for a due row
 * given any user override. Price defaults to the fetched price (rounded to
 * 2dp); qty defaults to plan.amount / price (rounded to 3dp) and tracks the
 * price until the user edits qty directly, which decouples it from the
 * amount; fee defaults to the plan's portfolio fee model.
 */
function deriveRow(row: DueRow, edit: RowEdit | undefined): EffectiveRow {
  const defaultPrice = round(row.price, 2);
  const priceEdited = edit?.price !== undefined;
  const qtyEdited = edit?.qty !== undefined;
  const feeEdited = edit?.fee !== undefined;

  const priceInput = priceEdited ? edit.price! : String(defaultPrice);
  const effectivePrice = priceEdited ? parseDecimal(edit.price!) : defaultPrice;

  let qtyInput: string;
  let effectiveQty: number;
  if (qtyEdited) {
    qtyInput = edit.qty!;
    effectiveQty = parseDecimal(edit.qty!);
  } else {
    const priceForQty = priceEdited ? effectivePrice : defaultPrice;
    const qtyValue =
      Number.isFinite(priceForQty) && priceForQty > 0
        ? round(row.plan.amount / priceForQty, 3)
        : NaN;
    qtyInput = Number.isFinite(qtyValue) ? String(qtyValue) : "";
    effectiveQty = qtyValue;
  }

  const feeInput = feeEdited ? edit.fee! : String(round(row.feeDefault, 2));
  const effectiveFeeParsed = feeEdited ? parseDecimal(edit.fee!) : row.feeDefault;
  const effectiveFee = Number.isFinite(effectiveFeeParsed) ? effectiveFeeParsed : 0;

  const edited = priceEdited || qtyEdited || feeEdited;
  const amount =
    (priceEdited || qtyEdited) && Number.isFinite(effectiveQty) && Number.isFinite(effectivePrice)
      ? round(effectiveQty * effectivePrice, 2)
      : row.plan.amount;

  return { priceInput, qtyInput, feeInput, effectivePrice, effectiveQty, effectiveFee, amount, edited };
}

export function SavingsPlansCard() {
  const enabled = useFeatureFlag("savingsPlans");
  const { data, addSavingsPlan, updateSavingsPlan, deleteSavingsPlan, addTransaction } =
    usePortfolio();
  const { version } = useCatalog();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [deleting, setDeleting] = useState<SavingsPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row user overrides for price/qty in the review dialog, keyed by
  // `${plan.id}:${date}`. Reset on open/close (never via effect — see
  // react-hooks/set-state-in-effect in CLAUDE.md).
  const [rowEdits, setRowEdits] = useState<Map<string, { price?: string; qty?: string }>>(
    new Map(),
  );

  function openReview() {
    setRowEdits(new Map());
    setReviewing(true);
  }

  function closeReview() {
    setReviewing(false);
    setRowEdits(new Map());
  }

  const assetById = useMemo(() => new Map(data.assets.map((a) => [a.id, a])), [data.assets]);
  const portfolioById = useMemo(
    () => new Map(data.portfolios.map((p) => [p.id, p])),
    [data.portfolios],
  );
  // A plan may live in a portfolio outside the current selection — use the
  // full plan list from data (plans aren't portfolio-scoped in scopedData).
  const plans = data.savingsPlans;
  const todayISO = today();

  // Every due (plan, date) pair across active plans whose asset still exists.
  const due = useMemo(() => {
    const out: { plan: SavingsPlan; asset: Asset; date: string }[] = [];
    for (const plan of plans) {
      const asset = assetById.get(plan.assetId);
      if (!asset) continue;
      for (const date of dueOccurrences(plan, todayISO)) out.push({ plan, asset, date });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [plans, assetById, todayISO]);

  // Real price history for the due assets (fetched only while reviewing).
  const dueAssets = useMemo(() => {
    const seen = new Map<string, Asset>();
    for (const d of due) seen.set(d.asset.id, d.asset);
    return [...seen.values()];
  }, [due]);
  const histItems = useMemo(
    () =>
      reviewing
        ? dueAssets.map(quoteItemFor).filter((x): x is NonNullable<typeof x> => x !== null)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewing, dueAssets, version],
  );
  const { histories, loading: historyLoading } = useHistory(histItems, "MAX", base);

  const dueRows = useMemo<DueRow[]>(
    () =>
      due.map(({ plan, asset, date }) => {
        // A CASH plan is a recurring deposit: price is exactly 1 by
        // definition (qty = amount), never an estimate.
        if (asset.type === "CASH") {
          return {
            plan,
            asset,
            date,
            price: 1,
            synthetic: false,
            feeDefault: savingsPlanFee(portfolioById.get(plan.portfolioId)),
          };
        }
        const key = assetPriceKey(asset);
        const hist = histories[key];
        const real = hist ? priceAtWithHeadTolerance(hist, date, 7) : null;
        return {
          plan,
          asset,
          date,
          price: real != null ? real : priceOn(key, asset.type, date),
          synthetic: real == null,
          feeDefault: savingsPlanFee(portfolioById.get(plan.portfolioId)),
        };
      }),
    [due, histories, portfolioById],
  );

  // Effective price/qty/amount per row, folding in any user override.
  const rowsWithEdits = useMemo(
    () =>
      dueRows.map((row) => ({
        row,
        derived: deriveRow(row, rowEdits.get(rowKey(row.plan.id, row.date))),
      })),
    [dueRows, rowEdits],
  );
  const hasInvalidRow = rowsWithEdits.some(
    ({ derived }) =>
      !Number.isFinite(derived.effectivePrice) ||
      derived.effectivePrice <= 0 ||
      !Number.isFinite(derived.effectiveQty) ||
      derived.effectiveQty <= 0,
  );

  function setRowEdit(key: string, patch: RowEdit) {
    setRowEdits((prev) => {
      const next = new Map(prev);
      next.set(key, { ...next.get(key), ...patch });
      return next;
    });
  }

  if (!enabled) return null;

  async function confirmDue() {
    setBusy(true);
    setError(null);
    try {
      // Sequential on purpose: each materialized BUY is an ordinary
      // transaction; a mid-way failure leaves lastRunDate un-advanced for the
      // affected plan, so the remaining occurrences simply surface again.
      const lastByPlan = new Map<string, string>();
      for (const { row, derived } of rowsWithEdits) {
        await addTransaction({
          assetId: row.asset.id,
          portfolioId: row.plan.portfolioId,
          type: "BUY",
          quantity: round(derived.effectiveQty, 3),
          price: derived.effectivePrice,
          fee: round(derived.effectiveFee, 2),
          tax: 0,
          date: `${row.date}T00:00:00`,
        });
        lastByPlan.set(row.plan.id, row.date);
      }
      for (const [planId, lastRunDate] of lastByPlan) {
        await updateSavingsPlan(planId, { lastRunDate });
      }
      closeReview();
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

  function handleToggleActive(plan: SavingsPlan) {
    setError(null);
    updateSavingsPlan(plan.id, { active: !plan.active }).catch((err: unknown) => {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("sp.actionError"));
    });
  }

  function handleDeletePlan(plan: SavingsPlan) {
    setError(null);
    deleteSavingsPlan(plan.id).catch((err: unknown) => {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("sp.actionError"));
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("sp.title")}</h2>
        {!creating && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            {t("sp.new")}
          </Button>
        )}
      </div>
      {error && !reviewing && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {due.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-sm text-amber-800 dark:text-amber-300">
            {t("sp.due", { count: due.length })}
          </span>
          <Button size="sm" variant="primary" onClick={openReview}>
            {t("sp.review")}
          </Button>
        </div>
      )}

      {creating && (
        <NewPlanForm
          onDone={() => setCreating(false)}
          onCreate={async (input) => {
            await addSavingsPlan(input);
            setCreating(false);
          }}
        />
      )}

      {plans.length === 0 && !creating ? (
        <p className="mt-3 text-sm text-zinc-500">{t("sp.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {plans.map((plan) => {
            const asset = assetById.get(plan.assetId);
            if (!asset) return null;
            const cur = asset.currency || base;
            return (
              <li key={plan.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {asset.name}
                    {!plan.active && (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-500 dark:bg-zinc-800">
                        {t("sp.paused")}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    <span data-private>{formatCurrency(plan.amount, cur)}</span>{" "}
                    {t(INTERVAL_KEY[plan.interval])}
                    {plan.active && (
                      <> · {t("sp.next", { date: formatDate(nextOccurrence(plan, todayISO)) })}</>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(plan)}
                    className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    {plan.active ? t("sp.pause") : t("sp.resume")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(plan)}
                    className="px-1 text-zinc-400 hover:text-red-500"
                    aria-label={t("sp.deleteTitle")}
                    title={t("sp.deleteTitle")}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Review dialog: due executions with the price each would post at. */}
      <Modal
        open={reviewing}
        onClose={() => {
          if (!busy) closeReview();
        }}
      >
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">{t("sp.reviewTitle")}</h3>
          <p className="text-sm text-zinc-500">{t("sp.reviewHint")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">{t("tx.date")}</th>
                  <th className="py-2 pr-3 font-medium">{t("sp.asset")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("sp.amount")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("tx.price")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("tx.fee")}</th>
                  <th className="py-2 text-right font-medium">{t("tx.qty")}</th>
                </tr>
              </thead>
              <tbody>
                {rowsWithEdits.map(({ row, derived }) => {
                  const cur = row.asset.currency || base;
                  const key = rowKey(row.plan.id, row.date);
                  return (
                    <tr
                      key={key}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="max-w-[16rem] truncate py-2 pr-3">{row.asset.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-private>
                        {formatCurrency(derived.amount, cur)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <input
                            inputMode="decimal"
                            aria-label={t("tx.price")}
                            value={derived.priceInput}
                            onChange={(e) =>
                              setRowEdit(key, { price: stripLeadingZero(e.target.value) })
                            }
                            className={rowInputCls}
                          />
                          {row.synthetic && !historyLoading && <EstimatedBadge compact />}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-private>
                        <input
                          inputMode="decimal"
                          aria-label={t("tx.fee")}
                          value={derived.feeInput}
                          onChange={(e) =>
                            setRowEdit(key, { fee: stripLeadingZero(e.target.value) })
                          }
                          className={rowInputCls}
                        />
                      </td>
                      <td className="py-2 text-right tabular-nums" data-private>
                        <input
                          inputMode="decimal"
                          aria-label={t("tx.qty")}
                          value={derived.qtyInput}
                          onChange={(e) =>
                            setRowEdit(key, { qty: stripLeadingZero(e.target.value) })
                          }
                          className={rowInputCls}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {historyLoading && <p className="text-xs text-zinc-400">{t("sp.loadingPrices")}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={closeReview}>
              {t("tx.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || historyLoading || dueRows.length === 0 || hasInvalidRow}
              onClick={() => void confirmDue()}
            >
              {busy ? t("sp.applying") : t("sp.confirm", { count: dueRows.length })}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={t("sp.deleteTitle")}
        message={
          deleting
            ? t("sp.deleteMsg", { name: assetById.get(deleting.assetId)?.name ?? "" })
            : undefined
        }
        confirmLabel={t("watchlist.removeConfirm")}
        onConfirm={() => {
          if (deleting) handleDeletePlan(deleting);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}

function NewPlanForm({
  onCreate,
  onDone,
}: {
  onCreate: (input: Omit<SavingsPlan, "id">) => Promise<void>;
  onDone: () => void;
}) {
  const { data, portfolios, selectedPortfolioIds, addAsset } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;

  // Securities book recurring BUYs at the market price; CASH positions book
  // recurring deposits at price 1 (e.g. vermögenswirksame Leistungen), so
  // every asset type is eligible.
  const eligible = data.assets;

  const [assetId, setAssetId] = useState(eligible[0]?.id ?? "");
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<SavingsPlanInterval>("MONTHLY");
  const [startDate, setStartDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline "add a new asset" row, revealed from the asset SelectMenu's
  // "+ New asset…" footer button — mirrors the watchlist card's resolution
  // (catalog first, then /api/lookup), but creates a portfolio asset (no
  // transaction booked; the plan itself will generate BUYs when due).
  const [addingAsset, setAddingAsset] = useState(false);
  const [newAssetQuery, setNewAssetQuery] = useState("");
  const [newAssetBusy, setNewAssetBusy] = useState(false);
  const [newAssetError, setNewAssetError] = useState<string | null>(null);

  const asset = eligible.find((a) => a.id === assetId);
  const cur = asset?.currency || base;

  const { touched, touch } = useFormTouched();
  // Presence-only gating for the "Create" button — mirrors handleSubmit's checks.
  const assetMissing = !assetId;
  const amountMissing = !amount.trim();
  const formIncomplete = assetMissing || amountMissing;

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
      await onCreate({
        assetId,
        portfolioId: portfolioId || portfolios[0]?.id || "",
        amount: amt,
        interval: frequency,
        startDate,
        active: true,
        lastRunDate: null,
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
          <SelectMenu
            value={assetId}
            ariaLabel={t("sp.asset")}
            onChange={(v) => {
              touch();
              setAssetId(v);
            }}
            options={eligible.map((a) => ({ value: a.id, label: a.name }))}
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
          {asset?.type === "CASH" && (
            <p className="mt-1 text-xs text-zinc-500">{t("sp.cashPlanHint")}</p>
          )}
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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onDone}>
          {t("tx.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy || formIncomplete}>
          {busy ? t("sp.applying") : t("sp.create")}
        </Button>
      </div>
    </form>
  );
}
