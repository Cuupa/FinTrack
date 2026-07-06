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
import { dueOccurrences, nextOccurrence } from "@/lib/finance/savings-plans";
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
import { formatCurrency, formatDate, formatNumber, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EstimatedBadge } from "@/components/ui/estimated-badge";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { MessageKey } from "@/lib/i18n/dictionaries";

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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

  const assetById = useMemo(() => new Map(data.assets.map((a) => [a.id, a])), [data.assets]);
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
        const key = assetPriceKey(asset);
        const hist = histories[key];
        const real = hist ? priceAtWithHeadTolerance(hist, date, 7) : null;
        return {
          plan,
          asset,
          date,
          price: real != null ? real : priceOn(key, asset.type, date),
          synthetic: real == null,
        };
      }),
    [due, histories],
  );

  if (!enabled) return null;

  async function confirmDue() {
    setBusy(true);
    setError(null);
    try {
      // Sequential on purpose: each materialized BUY is an ordinary
      // transaction; a mid-way failure leaves lastRunDate un-advanced for the
      // affected plan, so the remaining occurrences simply surface again.
      const lastByPlan = new Map<string, string>();
      for (const row of dueRows) {
        await addTransaction({
          assetId: row.asset.id,
          portfolioId: row.plan.portfolioId,
          type: "BUY",
          quantity: row.plan.amount / row.price,
          price: row.price,
          fee: 0,
          tax: 0,
          date: `${row.date}T00:00:00`,
        });
        lastByPlan.set(row.plan.id, row.date);
      }
      for (const [planId, lastRunDate] of lastByPlan) {
        await updateSavingsPlan(planId, { lastRunDate });
      }
      setReviewing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sp.applyError"));
    } finally {
      setBusy(false);
    }
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

      {due.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
          <span className="text-sm text-amber-800 dark:text-amber-300">
            {t("sp.due", { count: due.length })}
          </span>
          <Button size="sm" variant="primary" onClick={() => setReviewing(true)}>
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
                    onClick={() => void updateSavingsPlan(plan.id, { active: !plan.active })}
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
          if (!busy) setReviewing(false);
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
                  <th className="py-2 text-right font-medium">{t("tx.qty")}</th>
                </tr>
              </thead>
              <tbody>
                {dueRows.map((row) => {
                  const cur = row.asset.currency || base;
                  return (
                    <tr
                      key={`${row.plan.id}:${row.date}`}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="max-w-[16rem] truncate py-2 pr-3">{row.asset.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-private>
                        {formatCurrency(row.plan.amount, cur)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatCurrency(row.price, cur)}
                        {row.synthetic && !historyLoading && (
                          <EstimatedBadge compact className="ml-1" />
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums" data-private>
                        {formatNumber(row.plan.amount / row.price, 4)}
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
            <Button variant="secondary" disabled={busy} onClick={() => setReviewing(false)}>
              {t("tx.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || historyLoading || dueRows.length === 0}
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
          if (deleting) void deleteSavingsPlan(deleting.id);
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
  const { data, portfolios, selectedPortfolioIds } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;

  // Cash has no course to buy at — plans apply to securities only.
  const eligible = useMemo(() => data.assets.filter((a) => a.type !== "CASH"), [data.assets]);

  const [assetId, setAssetId] = useState(eligible[0]?.id ?? "");
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<SavingsPlanInterval>("MONTHLY");
  const [startDate, setStartDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asset = eligible.find((a) => a.id === assetId);
  const cur = asset?.currency || base;

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
      setError(err instanceof Error ? err.message : t("sp.applyError"));
    } finally {
      setBusy(false);
    }
  }

  if (eligible.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500">{t("sp.noAssets")}</p>;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t("sp.asset")}</span>
          <SelectMenu
            value={assetId}
            ariaLabel={t("sp.asset")}
            onChange={setAssetId}
            options={eligible.map((a) => ({ value: a.id, label: a.name }))}
            searchable
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">{t("sp.amount")}</span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(stripLeadingZero(e.target.value))}
              className={`${inputCls} pr-12`}
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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onDone}>
          {t("tx.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? t("sp.applying") : t("sp.create")}
        </Button>
      </div>
    </form>
  );
}
