"use client";

// Named savings goals (ROADMAP #6, flag `goals`): a target amount, optionally
// by a target date, whose progress either mirrors a linked account's current
// balance or is entered manually. Everything rides the store seam via
// usePortfolio(); no mode branching.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import { goalProgress, goalProgressPct, requiredMonthlyContribution } from "@/lib/finance/goals";
import type { Goal } from "@/lib/types";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { colorForLabel } from "@/lib/colors";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

const MANUAL_TRACKING = "";

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
  const [linkedAccountId, setLinkedAccountId] = useState(MANUAL_TRACKING);
  const linkedIsLiability = Boolean(
    linkedAccountId && data.accounts.find((a) => a.id === linkedAccountId)?.isLiability,
  );
  const [manualCurrentAmount, setManualCurrentAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "targetDate",
    dir: "asc",
  });
  const [confirmDelete, setConfirmDelete] = useState<Goal | null>(null);

  const rows = useMemo(() => {
    const withProgress = data.goals.map((g) => {
      const current = goalProgress(g, data.accounts, data.accountBalances, valuation);
      const pct = goalProgressPct(g.targetAmount, current);
      const monthly = requiredMonthlyContribution(g, current, todayIso);
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
  }, [data.goals, data.accounts, data.accountBalances, valuation, sort, todayIso]);

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
      await addGoal({
        name: trimmedName,
        targetAmount: value,
        targetDate: targetDate || null,
        linkedAccountId: linkedAccountId || null,
        manualCurrentAmount:
          linkedAccountId || manual === null || !Number.isFinite(manual) ? null : manual,
      });
      setName("");
      setTargetAmount("");
      setTargetDate("");
      setLinkedAccountId(MANUAL_TRACKING);
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
      <Card>
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
          </div>
          <div>
            <label className="text-sm font-medium">{t("goals.form.linkedAccountLabel")}</label>
            <SelectMenu
              className="mt-1 w-full"
              ariaLabel={t("goals.form.linkedAccountLabel")}
              value={linkedAccountId}
              onChange={setLinkedAccountId}
              options={[
                { value: MANUAL_TRACKING, label: t("goals.form.manualTracking") },
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
          {!linkedAccountId && (
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

      <Card>
        <h2 className="text-lg font-semibold">{t("goals.list.title")}</h2>
        {data.goals.length === 0 ? (
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
                  const linkedAccount = goal.linkedAccountId
                    ? accountsById.get(goal.linkedAccountId)
                    : null;
                  return (
                    <tr
                      key={goal.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-medium" data-private>
                        {goal.name}
                        <div className="text-xs font-normal text-zinc-500">
                          {linkedAccount
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
                      <td className="px-3 py-2">{goal.targetDate ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(goal)}>
                            {t("goals.list.delete")}
                          </Button>
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
