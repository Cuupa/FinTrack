"use client";

// Named savings goals (ROADMAP #6, flag `goals`): a target amount, optionally
// by a target date, whose progress either mirrors a linked account's current
// balance or is entered manually. Everything rides the store seam via
// usePortfolio(); no mode branching.
//
// The list also carries the payoff goals derived from the user's liability
// accounts (`liabilityPayoffGoals`) -- owing money already IS a goal, so it
// shows up without being restated by hand. Those rows are read-only here: the
// account behind them owns their numbers.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import {
  goalInvestments,
  goalProgress,
  goalProgressPct,
  isPayoffGoal,
  liabilityPayoffGoals,
  requiredMonthlyContribution,
} from "@/lib/finance/goals";
import type { Goal } from "@/lib/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { colorForLabel } from "@/lib/colors";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

// The tracking picker is one control over three sources, so its value is a
// tagged string: "" = manual, "depot:" = every broker, "depot:<portfolioId>"
// = one broker, anything else = that account's id.
const MANUAL_TRACKING = "";
const DEPOT_PREFIX = "depot:";
const DEPOT_ALL = DEPOT_PREFIX;
const isDepotTracking = (v: string) => v.startsWith(DEPOT_PREFIX);

type SortKey = "name" | "progress" | "targetAmount" | "targetDate";

export function GoalsView() {
  const { data, addGoal, deleteGoal } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const todayIso = today();

  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );

  // Add-goal form state.
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [tracking, setTracking] = useState(MANUAL_TRACKING);
  const linkedIsLiability = Boolean(
    tracking &&
      !isDepotTracking(tracking) &&
      data.accounts.find((a) => a.id === tracking)?.isLiability,
  );
  const [manualCurrentAmount, setManualCurrentAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not targetDate: an open-ended goal is a first-class goal, so the default
  // order must not be the one column it deliberately leaves empty.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "progress",
    dir: "desc",
  });
  const [confirmDelete, setConfirmDelete] = useState<Goal | null>(null);

  // Depot value overall and per broker, for goals that track investments.
  const investments = useMemo(
    () => goalInvestments(data.assets, data.transactions, data.portfolios, valuation),
    [data.assets, data.transactions, data.portfolios, valuation],
  );

  // Every liability is a payoff goal already; the user only has to say so for
  // the ones they want to track differently (a manual goal on the same
  // account replaces the derived one).
  const payoffGoals = useMemo(
    () =>
      liabilityPayoffGoals(data.accounts, data.accountBalances, data.goals, todayIso, valuation),
    [data.accounts, data.accountBalances, data.goals, todayIso, valuation],
  );

  const rows = useMemo(() => {
    const withProgress = [...payoffGoals, ...data.goals].map((g) => {
      const current = goalProgress(g, data.accounts, data.accountBalances, valuation, investments);
      const pct = goalProgressPct(g.targetAmount, current);
      // The monthly figure a payoff goal needs is its minimum payment plus
      // interest, which /debt already amortises properly -- dividing the
      // remaining principal by the months would understate it here.
      const monthly = isPayoffGoal(g) ? null : requiredMonthlyContribution(g, current, todayIso);
      return { goal: g, current, pct, monthly };
    });
    withProgress.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.goal.name.localeCompare(y.goal.name);
      else if (sort.key === "progress") cmp = x.pct - y.pct;
      else if (sort.key === "targetAmount") cmp = x.goal.targetAmount - y.goal.targetAmount;
      else cmp = (x.goal.targetDate ?? "").localeCompare(y.goal.targetDate ?? "");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return withProgress;
  }, [
    data.goals,
    data.accounts,
    data.accountBalances,
    payoffGoals,
    valuation,
    sort,
    todayIso,
    investments,
  ]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  async function submit() {
    const trimmedName = name.trim();
    const value = parseDecimal(targetAmount);
    if (!trimmedName || !Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const manual = manualCurrentAmount.trim() ? parseDecimal(manualCurrentAmount) : null;
      const depot = isDepotTracking(tracking);
      await addGoal({
        name: trimmedName,
        targetAmount: value,
        targetDate: targetDate || null,
        linkedAccountId: depot ? null : tracking || null,
        tracksInvestments: depot,
        linkedPortfolioId: depot ? tracking.slice(DEPOT_PREFIX.length) || null : null,
        manualCurrentAmount:
          tracking || manual === null || !Number.isFinite(manual) ? null : manual,
      });
      setName("");
      setTargetAmount("");
      setTargetDate("");
      setTracking(MANUAL_TRACKING);
      setManualCurrentAmount("");
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("goals.form.error"));
    } finally {
      setBusy(false);
    }
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="space-y-6">
      <Card data-tour="goals-form">
        <h2 className="text-lg font-semibold">{t("goals.form.title")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="text-sm font-medium" htmlFor="goal-name">
              {t("goals.form.nameLabel")}
            </label>
            <input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("goals.form.namePlaceholder")}
              className={inputCls}
              data-private
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="goal-target">
              {t("goals.form.targetLabel", { currency: base })}
            </label>
            <input
              id="goal-target"
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(stripLeadingZero(e.target.value))}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="goal-date">
              {t("goals.form.dateLabel")}
            </label>
            <input
              id="goal-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-sm text-zinc-500">{t("goals.form.dateHint")}</p>
          </div>
          <div>
            <label className="text-sm font-medium">{t("goals.form.linkedAccountLabel")}</label>
            <SelectMenu
              className="mt-1 w-full"
              ariaLabel={t("goals.form.linkedAccountLabel")}
              value={tracking}
              onChange={setTracking}
              options={[
                { value: MANUAL_TRACKING, label: t("goals.form.manualTracking") },
                // The depot has no account to link to (its value is derived
                // from the transaction log), so it gets its own entries.
                { value: DEPOT_ALL, label: t("goals.form.wholeDepot") },
                ...data.portfolios.map((p) => ({
                  value: `${DEPOT_PREFIX}${p.id}`,
                  label: t("goals.form.brokerDepot", { name: p.name }),
                })),
                // Liabilities are marked, because linking one flips what the
                // goal means: progress becomes what has been repaid, not the
                // balance itself.
                ...data.accounts.map((a) => ({
                  value: a.id,
                  label: a.isLiability ? `${a.name} — ${t("goals.form.payOff")}` : a.name,
                })),
              ]}
            />
            {linkedIsLiability && (
              <p className="mt-1 text-sm text-zinc-500">
                {t("goals.form.payOffHint", { currency: base })}
              </p>
            )}
          </div>
          {!tracking && (
            <div>
              <label className="text-sm font-medium" htmlFor="goal-manual-current">
                {t("goals.form.manualCurrentLabel", { currency: base })}
              </label>
              <input
                id="goal-manual-current"
                inputMode="decimal"
                value={manualCurrentAmount}
                onChange={(e) => setManualCurrentAmount(stripLeadingZero(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder="0"
                className={inputCls}
                data-private
              />
            </div>
          )}
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={busy || !name.trim() || !targetAmount.trim()}
              onClick={() => void submit()}
            >
              {t("goals.form.add")}
            </Button>
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </Card>

      <Card data-tour="goals-list">
        <h2 className="text-lg font-semibold">{t("goals.list.title")}</h2>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("goals.list.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("name")}>
                    {t("goals.list.name")}
                    {arrow("name")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("progress")}>
                    {t("goals.list.progress")}
                    {arrow("progress")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("targetAmount")}>
                    {t("goals.list.target")}
                    {arrow("targetAmount")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("targetDate")}>
                    {t("goals.list.targetDate")}
                    {arrow("targetDate")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ goal, current, pct, monthly }) => {
                  const color = colorForLabel(goal.name);
                  const derived = isPayoffGoal(goal);
                  const linkedAccount = goal.linkedAccountId
                    ? accountsById.get(goal.linkedAccountId)
                    : null;
                  const depotBroker =
                    goal.tracksInvestments && goal.linkedPortfolioId
                      ? data.portfolios.find((p) => p.id === goal.linkedPortfolioId)
                      : null;
                  return (
                    <tr
                      key={goal.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-medium" data-private>
                        {goal.name}
                        <div className="text-xs font-normal text-zinc-500">
                          {derived
                            ? t("goals.list.autoPayoff")
                            : goal.tracksInvestments
                              ? depotBroker
                                ? t("goals.form.brokerDepot", { name: depotBroker.name })
                                : t("goals.form.wholeDepot")
                              : linkedAccount
                                ? t("goals.list.linkedTo", { name: linkedAccount.name })
                                : t("goals.list.manualTracking")}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="min-w-[10rem]">
                          <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                            <span data-private>
                              {formatCurrency(current, base)} / {formatCurrency(goal.targetAmount, base)}
                            </span>
                            <span>{Math.round(pct)}%</span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: color }}
                            />
                          </div>
                          {monthly !== null && (
                            <p className="mt-1 text-xs text-zinc-500">
                              {t("goals.list.monthlyNeeded", { amount: formatCurrency(monthly, base) })}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" data-private>
                        {formatCurrency(goal.targetAmount, base)}
                      </td>
                      <td className="px-3 py-2">
                        {goal.targetDate ? (
                          formatDate(goal.targetDate)
                        ) : (
                          <span className="text-zinc-500">{t("goals.list.openEnded")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          {!derived && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setConfirmDelete(goal)}
                            >
                              {t("goals.list.delete")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("goals.delete.title")}
        message={confirmDelete ? t("goals.delete.message", { name: confirmDelete.name }) : undefined}
        confirmLabel={t("goals.list.delete")}
        onConfirm={() => {
          if (confirmDelete) void deleteGoal(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
