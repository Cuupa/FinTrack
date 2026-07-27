"use client";

// Named savings goals (ROADMAP #6, flag `goals`): a target amount, optionally
// by a target date, whose progress either mirrors a linked account's balance,
// the depot's value, or an amount the user keeps up to date by hand.
// Everything rides the store seam via usePortfolio(); no mode branching.
//
// The list also carries the payoff goals derived from the user's liability
// accounts (`liabilityPayoffGoals`) -- owing money already IS a goal, so it
// shows up without being restated by hand. Those rows are read-only here: the
// account behind them owns their numbers.
//
// The same `GoalForm` serves the add card and the edit dialog, so a goal's
// amount (and every other field) stays changeable after it was created.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import {
  goalInvestments,
  goalProgressPct,
  goalTotals,
  isPayoffGoal,
  liabilityPayoffGoals,
  requiredMonthlyContribution,
  subGoals,
  topLevelGoals,
} from "@/lib/finance/goals";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import type { Account, Asset, Goal, Portfolio } from "@/lib/types";
import type { GoalInput } from "@/lib/store/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { colorForLabel } from "@/lib/colors";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { TablePagination, usePagination } from "@/components/ui/table";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

// The tracking picker is one control over four sources, so its value is a
// tagged string: "" = manual, "depot:" = every broker, "depot:<portfolioId>"
// = one broker, "asset:<assetId>" = a single position, anything else = that
// account's id.
const MANUAL_TRACKING = "";
const DEPOT_PREFIX = "depot:";
const DEPOT_ALL = DEPOT_PREFIX;
const ASSET_PREFIX = "asset:";
const isDepotTracking = (v: string) => v.startsWith(DEPOT_PREFIX) || v.startsWith(ASSET_PREFIX);
const isAssetTracking = (v: string) => v.startsWith(ASSET_PREFIX);

/** A stored goal, back as the tagged value of the tracking picker. */
function trackingOf(goal: Goal): string {
  if (goal.tracksInvestments) {
    // The narrower scope wins, exactly as `goalProgress` reads it.
    if (goal.linkedAssetId) return `${ASSET_PREFIX}${goal.linkedAssetId}`;
    return `${DEPOT_PREFIX}${goal.linkedPortfolioId ?? ""}`;
  }
  return goal.linkedAccountId ?? MANUAL_TRACKING;
}

type SortKey = "name" | "progress" | "targetAmount" | "targetDate";

/** A goal plus the figures shown for it. `target`/`current` are the derived
 *  ones, so a composite goal reports the sum over its sub-goals. */
interface Row {
  goal: Goal;
  target: number;
  current: number;
  pct: number;
  monthly: number | null;
}

/** One top-level goal with its sub-goals, in display order. */
interface TreeRow extends Row {
  children: Row[];
}

const NO_PARENT = "";

/**
 * Add/edit form for a single goal. Seeded from `initial` when editing, empty
 * when adding; the caller decides which goals may be picked as a parent (one
 * level deep, never itself) and what happens after a successful save.
 */
function GoalForm({
  base,
  accounts,
  portfolios,
  assets,
  parentCandidates,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDone,
  childCount = 0,
  // Tailwind breakpoints are viewport-based, so the dialog has to ask for
  // fewer columns itself: three of them in a max-w-2xl panel are cramped.
  gridCls = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  base: string;
  accounts: Account[];
  portfolios: Portfolio[];
  /** Held positions, offered as single-position goal targets. */
  assets: Asset[];
  parentCandidates: Goal[];
  initial?: Goal;
  submitLabel: string;
  onSubmit: (input: GoalInput) => Promise<unknown>;
  onCancel?: () => void;
  onDone?: () => void;
  /** Number of sub-goals the edited goal has; > 0 makes it composite. */
  childCount?: number;
  gridCls?: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [targetAmount, setTargetAmount] = useState(initial ? String(initial.targetAmount) : "");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [tracking, setTracking] = useState(initial ? trackingOf(initial) : MANUAL_TRACKING);
  const [manualCurrentAmount, setManualCurrentAmount] = useState(
    initial?.manualCurrentAmount != null ? String(initial.manualCurrentAmount) : "",
  );
  // Empty = a standalone goal. Only top-level goals are offered: a sub-goal
  // is a line item ("flight"), never a project of its own.
  const [parentGoalId, setParentGoalId] = useState(initial?.parentGoalId ?? NO_PARENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedIsLiability = Boolean(
    tracking && !isDepotTracking(tracking) && accounts.find((a) => a.id === tracking)?.isLiability,
  );

  // A goal made of parts takes its target AND its progress from them
  // (`goalTotals`), so its own amount and tracking are dead fields: showing
  // them here would contradict every figure the list prints for that row.
  const composite = Boolean(initial) && childCount > 0;

  /**
   * The goal to save, or null when the form is not valid yet. Composite goals
   * only expose name + date; their stored amount and tracking fields ride
   * along untouched rather than being rewritten from state that was never
   * shown.
   */
  function collect(): GoalInput | null {
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    if (composite && initial) {
      return {
        name: trimmedName,
        targetDate: targetDate || null,
        targetAmount: initial.targetAmount,
        linkedAccountId: initial.linkedAccountId,
        tracksInvestments: initial.tracksInvestments,
        linkedPortfolioId: initial.linkedPortfolioId,
        linkedAssetId: initial.linkedAssetId,
        manualCurrentAmount: initial.manualCurrentAmount,
        parentGoalId: initial.parentGoalId,
      };
    }
    const value = parseDecimal(targetAmount);
    if (!Number.isFinite(value) || value <= 0) return null;
    const manual = manualCurrentAmount.trim() ? parseDecimal(manualCurrentAmount) : null;
    const depot = isDepotTracking(tracking);
    const position = isAssetTracking(tracking);
    return {
      name: trimmedName,
      targetAmount: value,
      targetDate: targetDate || null,
      linkedAccountId: depot ? null : tracking || null,
      tracksInvestments: depot,
      // A single position spans every broker, so the two scopes are exclusive:
      // whichever one the picker names, the other stays null.
      linkedPortfolioId:
        depot && !position ? tracking.slice(DEPOT_PREFIX.length) || null : null,
      linkedAssetId: position ? tracking.slice(ASSET_PREFIX.length) : null,
      manualCurrentAmount: tracking || manual === null || !Number.isFinite(manual) ? null : manual,
      // Re-checked against the live list: the picked parent may have been
      // deleted (or turned into a sub-goal) since it was selected.
      parentGoalId: parentCandidates.some((g) => g.id === parentGoalId) ? parentGoalId : null,
    };
  }

  async function submit() {
    const input = collect();
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
      if (!initial) {
        setName("");
        setTargetAmount("");
        setTargetDate("");
        setTracking(MANUAL_TRACKING);
        setManualCurrentAmount("");
        setParentGoalId(NO_PARENT);
      }
      onDone?.();
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("goals.form.error"));
    } finally {
      setBusy(false);
    }
  }

  // Prefixed while editing so the dialog's inputs never share an id with the
  // add form behind it.
  const id = (field: string) => `goal-${initial ? "edit-" : ""}${field}`;

  return (
    <>
      <div className={`mt-4 grid gap-4 ${gridCls}`}>
        <div>
          <label className="text-sm font-medium" htmlFor={id("name")}>
            {t("goals.form.nameLabel")}
          </label>
          <input
            id={id("name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("goals.form.namePlaceholder")}
            className={inputCls}
            data-private
          />
        </div>
        {!composite && (
          <div>
            <label className="text-sm font-medium" htmlFor={id("target")}>
              {t("goals.form.targetLabel", { currency: base })}
            </label>
            <input
              id={id("target")}
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(stripLeadingZero(e.target.value))}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
        )}
        <div>
          <label className="text-sm font-medium" htmlFor={id("date")}>
            {t("goals.form.dateLabel")}
          </label>
          <input
            id={id("date")}
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-sm text-zinc-500">{t("goals.form.dateHint")}</p>
        </div>
        {composite ? (
          <div className="sm:col-span-2">
            <p className="text-sm text-zinc-500">
              {t("goals.edit.compositeHint", { n: childCount })}
            </p>
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium">{t("goals.form.linkedAccountLabel")}</label>
            <SelectMenu
              className="mt-1 w-full"
              ariaLabel={t("goals.form.linkedAccountLabel")}
              // Accounts plus every position adds up to a long list.
              searchable
              value={tracking}
              onChange={setTracking}
              options={[
                { value: MANUAL_TRACKING, label: t("goals.form.manualTracking") },
                // The depot has no account to link to (its value is derived
                // from the transaction log), so it gets its own entries.
                { value: DEPOT_ALL, label: t("goals.form.wholeDepot") },
                ...portfolios.map((p) => ({
                  value: `${DEPOT_PREFIX}${p.id}`,
                  label: t("goals.form.brokerDepot", { name: p.name }),
                })),
                // One position ("the ETF should be worth 10k"): the narrowest
                // depot scope, spanning every broker the asset is held at.
                ...assets.map((a) => ({
                  value: `${ASSET_PREFIX}${a.id}`,
                  label: t("goals.form.position", { name: a.name }),
                })),
                // Liabilities are marked, because linking one flips what the
                // goal means: progress becomes what has been repaid, not the
                // balance itself.
                ...accounts.map((a) => ({
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
        )}
        {!composite && parentCandidates.length > 0 && (
          <div>
            <label className="text-sm font-medium">{t("goals.form.parentLabel")}</label>
            <SelectMenu
              className="mt-1 w-full"
              ariaLabel={t("goals.form.parentLabel")}
              value={parentGoalId}
              onChange={setParentGoalId}
              options={[
                { value: NO_PARENT, label: t("goals.form.noParent") },
                ...parentCandidates.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            <p className="mt-1 text-sm text-zinc-500">{t("goals.form.parentHint")}</p>
          </div>
        )}
        {!composite && !tracking && (
          <div>
            <label className="text-sm font-medium" htmlFor={id("manual-current")}>
              {t("goals.form.manualCurrentLabel", { currency: base })}
            </label>
            <input
              id={id("manual-current")}
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
            <p className="mt-1 text-sm text-zinc-500">{t("goals.form.manualCurrentHint")}</p>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button
            variant="primary"
            disabled={busy || !name.trim() || (!composite && !targetAmount.trim())}
            onClick={() => void submit()}
          >
            {submitLabel}
          </Button>
          {onCancel && (
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}

export function GoalsView() {
  const { data, addGoal, updateGoal, deleteGoal } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const todayIso = today();

  const accountsById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );

  // Not targetDate: an open-ended goal is a first-class goal, so the default
  // order must not be the one column it deliberately leaves empty.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "progress",
    dir: "desc",
  });
  const [confirmDelete, setConfirmDelete] = useState<Goal | null>(null);
  const deletedSubGoals = confirmDelete ? subGoals(data.goals, confirmDelete.id).length : 0;
  const [editing, setEditing] = useState<Goal | null>(null);

  // Depot value overall and per broker, for goals that track investments.
  const investments = useMemo(
    () => goalInvestments(data.assets, data.transactions, data.portfolios, valuation),
    [data.assets, data.transactions, data.portfolios, valuation],
  );

  // Every asset is offerable as a single-position goal, including one not held
  // yet: "Meta should be worth 2k" is a goal to BUILD the position, so its
  // progress simply starts at 0.
  const goalAssets = useMemo(
    () => [...data.assets].sort((a, b) => a.name.localeCompare(b.name)),
    [data.assets],
  );

  // Every liability is a payoff goal already; the user only has to say so for
  // the ones they want to track differently (a top-level goal of their own on
  // the same account replaces the derived one).
  const movements = useAccountMovements();

  const payoffGoals = useMemo(
    () =>
      liabilityPayoffGoals(
        data.accounts,
        data.accountBalances,
        data.goals,
        todayIso,
        valuation,
        movements,
      ),
    [data.accounts, data.accountBalances, data.goals, todayIso, valuation, movements],
  );

  // Only top-level goals can take sub-goals (one level deep), and a derived
  // payoff goal is owned by its account, so it is no candidate either.
  const parentCandidates = useMemo(() => topLevelGoals(data.goals), [data.goals]);

  // Editing: a goal can never become its own part, and one that already has
  // parts cannot be demoted to a part itself (nesting stays one level deep) --
  // then the picker is dropped entirely.
  const editParentCandidates = useMemo(() => {
    if (!editing) return [];
    if (subGoals(data.goals, editing.id).length > 0) return [];
    return parentCandidates.filter((g) => g.id !== editing.id);
  }, [editing, data.goals, parentCandidates]);

  const rows = useMemo(() => {
    const measure = (goal: Goal, children: Goal[]): Row => {
      const { target, current } = goalTotals(
        goal,
        children,
        data.accounts,
        data.accountBalances,
        valuation,
        investments,
        movements,
      );
      return {
        goal,
        target,
        current,
        pct: goalProgressPct(target, current),
        // The monthly figure a payoff goal needs is its minimum payment plus
        // interest, which /debt already amortises properly -- dividing the
        // remaining principal by the months would understate it here.
        monthly: isPayoffGoal(goal)
          ? null
          : requiredMonthlyContribution(goal, current, todayIso, target),
      };
    };

    const bySort = (x: Row, y: Row) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.goal.name.localeCompare(y.goal.name);
      else if (sort.key === "progress") cmp = x.pct - y.pct;
      else if (sort.key === "targetAmount") cmp = x.target - y.target;
      else cmp = (x.goal.targetDate ?? "").localeCompare(y.goal.targetDate ?? "");
      return sort.dir === "asc" ? cmp : -cmp;
    };

    // Sub-goals stay under their parent; sorting reorders the top level and,
    // inside each composite goal, its own parts.
    const tree: TreeRow[] = [...payoffGoals, ...topLevelGoals(data.goals)].map((g) => {
      const children = subGoals(data.goals, g.id);
      return { ...measure(g, children), children: children.map((c) => measure(c, [])).sort(bySort) };
    });
    tree.sort(bySort);
    return tree;
  }, [
    data.goals,
    data.accounts,
    data.accountBalances,
    payoffGoals,
    valuation,
    sort,
    todayIso,
    investments,
    movements,
  ]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  /**
   * One table row. `childCount` > 0 marks a composite goal, whose figures are
   * the sum over its parts -- its own tracking is not shown, because it is
   * not used (lib/finance/goals.ts `goalTotals`). `isChild` indents a
   * sub-goal under the goal it belongs to.
   */
  function renderRow(
    { goal, target, current, pct, monthly }: Row,
    childCount: number,
    isChild = false,
  ) {
    const color = colorForLabel(goal.name);
    const derived = isPayoffGoal(goal);
    const linkedAccount = goal.linkedAccountId ? accountsById.get(goal.linkedAccountId) : null;
    const linkedAsset =
      goal.tracksInvestments && goal.linkedAssetId
        ? data.assets.find((a) => a.id === goal.linkedAssetId)
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
        <td className={`px-3 py-2 font-medium ${isChild ? "pl-8" : ""}`} data-private>
          {isChild && <span className="mr-1 text-zinc-400">↳</span>}
          {goal.name}
          <div className="text-xs font-normal text-zinc-500">
            {childCount > 0
              ? t("goals.list.sumOfSubGoals", { n: childCount })
              : derived
                ? t("goals.list.autoPayoff")
                : goal.tracksInvestments
                  ? linkedAsset
                    ? t("goals.form.position", { name: linkedAsset.name })
                    : depotBroker
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
                {formatCurrency(current, base)} / {formatCurrency(target, base)}
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
          {formatCurrency(target, base)}
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
              <>
                <Button size="sm" variant="secondary" onClick={() => setEditing(goal)}>
                  {t("goals.list.edit")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(goal)}>
                  {t("goals.list.delete")}
                </Button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }

  const pager = usePagination(rows);

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="space-y-6">
      <Card data-tour="goals-form">
        <h2 className="text-lg font-semibold">{t("goals.form.title")}</h2>
        <GoalForm
          base={base}
          accounts={data.accounts}
          portfolios={data.portfolios}
          assets={goalAssets}
          parentCandidates={parentCandidates}
          submitLabel={t("goals.form.add")}
          onSubmit={addGoal}
        />
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
                {pager.rows.flatMap((row) => [
                  renderRow(row, row.children.length),
                  ...row.children.map((child) => renderRow(child, 0, true)),
                ])}
              </tbody>
            </table>
            <TablePagination pager={pager} />
          </div>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <Card>
            <h2 className="text-lg font-semibold">{t("goals.edit.title")}</h2>
            {/* Keyed on the goal so opening another row re-seeds the fields. */}
            <GoalForm
              key={editing.id}
              base={base}
              accounts={data.accounts}
              portfolios={data.portfolios}
              assets={goalAssets}
              parentCandidates={editParentCandidates}
              initial={editing}
              childCount={subGoals(data.goals, editing.id).length}
              gridCls="sm:grid-cols-2"
              submitLabel={t("goals.edit.save")}
              onSubmit={(input) => updateGoal(editing.id, input)}
              onCancel={() => setEditing(null)}
              onDone={() => setEditing(null)}
            />
          </Card>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("goals.delete.title")}
        // Deleting a parent takes its sub-goals with it (store + DB cascade),
        // so the confirmation says how many.
        message={
          confirmDelete
            ? deletedSubGoals > 0
              ? t("goals.delete.messageWithSubGoals", {
                  name: confirmDelete.name,
                  n: deletedSubGoals,
                })
              : t("goals.delete.message", { name: confirmDelete.name })
            : undefined
        }
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
