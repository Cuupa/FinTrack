"use client";

// Debt payoff planner (ROADMAP #9, flag `debtPayoff`): liability accounts
// (ROADMAP #1) gain amortisation. Interest rate, fixed-rate period and minimum
// payment are entered per account via `DebtDetailsDialog`; this view turns them
// into a per-debt schedule, an avalanche/snowball extra-payment simulator and
// the charts that make the decades-long shape of a mortgage legible
// (lib/finance/debt.ts). Everything rides the store seam via usePortfolio();
// no mode branching.
//
// Planned one-off repayments sit in the plan card next to the extra monthly
// payment (`DebtRepaymentsPlanner`), because they are a what-if input of this
// simulation -- a repayment actually made is a transfer on the accounts page.
//
// Durations are always shown as years + months (owner rule, round 26): nobody
// converts "490 months" in their head.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import {
  today,
  addMonthsToDate,
  timeframeStart,
  TIMEFRAMES,
  type Timeframe,
} from "@/lib/finance/dates";
import { balanceSeries, currentAccountBalance, accountFxRate } from "@/lib/finance/accounts";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import {
  accountRateSteps,
  amortizationSchedule,
  planPayoff,
  yearlySplit,
  type DebtInput,
  type DebtStrategy,
} from "@/lib/finance/debt";
import type { Account } from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  parseDecimal,
  stripLeadingZero,
} from "@/lib/format";
import { formatMonths, formatMonthsShort } from "@/lib/i18n/duration";
import { Button, Card, SegmentedControl, Stat } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { DebtDetailsDialog } from "./debt-details-dialog";
import { DebtRepaymentsPlanner } from "./debt-repayments";
import { DebtBalanceChart, DebtSplitChart, debtColor } from "./debt-chart";

type SortKey = "name" | "balance" | "rate" | "lumpSums" | "term" | "payoffDate";

/** The scope selector's "everything at once" value; any other value is an
 *  account id. Not a valid uuid, so it can never collide with one. */
const ALL = "*all*";

export function DebtView() {
  const { data } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;
  const todayIso = today();

  const liabilityAccounts = useMemo(
    () => data.accounts.filter((a) => a.isLiability),
    [data.accounts],
  );

  const movements = useAccountMovements();

  const rows = useMemo(() => {
    return liabilityAccounts.map((account) => {
      const rate = accountFxRate(account, valuation);
      const balance = currentAccountBalance(account, data.accountBalances, movements) * rate;
      const hasSchedule = account.interestRate != null && account.minPayment != null;
      const steps = accountRateSteps(account);
      // Planned lump sums, converted to the base currency like the instalment.
      // Ones dated in the past are already inside the balance above, so the
      // schedule drops them (lumpSumsByMonth) rather than paying them twice.
      const lumpSums = data.extraRepayments
        .filter((r) => r.accountId === account.id)
        .map((r) => ({ date: r.date, amount: r.amount * rate }));
      const schedule = hasSchedule
        ? amortizationSchedule(
            balance,
            account.interestRate!,
            account.minPayment! * rate,
            todayIso,
            steps,
            lumpSums,
          )
        : null;
      // What was owed on each past date: the loan sum at `openedOn`, every
      // balance the user has entered since, carried forward. The gap between
      // the two IS what has been repaid, which is the only way a liability
      // chart can start where the debt started instead of at today.
      const history = balanceSeries(account, data.accountBalances, movements)
        .filter((p) => p.date <= todayIso)
        .map((p) => ({ date: p.date, balance: p.balance * rate }));
      const original = account.openingBalance * rate;
      return {
        account,
        balance,
        history,
        original,
        repaid: Math.max(0, original - balance),
        payment: (account.minPayment ?? 0) * rate,
        steps,
        lumpSums,
        plannedLumpSums: lumpSums
          .filter((l) => l.date >= todayIso)
          .reduce((s, l) => s + l.amount, 0),
        schedule,
      };
    });
  }, [
    liabilityAccounts,
    data.accountBalances,
    data.extraRepayments,
    valuation,
    todayIso,
    movements,
  ]);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "balance",
    dir: "desc",
  });
  const [detailsFor, setDetailsFor] = useState<Account | null>(null);
  // How far back the chart reaches. The same strip the depot chart uses, for
  // the same reason: "from today" answers nothing about a debt you have been
  // paying for eight years.
  const [tf, setTf] = useState<Timeframe>("1Y");
  const [strategy, setStrategy] = useState<DebtStrategy>("avalanche");
  const [extra, setExtra] = useState("");
  const [scope, setScope] = useState<string>(ALL);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.account.name.localeCompare(y.account.name);
      else if (sort.key === "balance") cmp = x.balance - y.balance;
      else if (sort.key === "rate")
        cmp = (x.account.interestRate ?? -1) - (y.account.interestRate ?? -1);
      else if (sort.key === "lumpSums") cmp = x.plannedLumpSums - y.plannedLumpSums;
      else cmp = (x.schedule?.months ?? Infinity) - (y.schedule?.months ?? Infinity);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  const totalDebt = rows.reduce((s, r) => s + r.balance, 0);
  const totalMinPayment = rows.reduce((s, r) => s + r.payment, 0);
  const totalOriginal = rows.reduce((s, r) => s + r.original, 0);
  const totalRepaid = rows.reduce((s, r) => s + r.repaid, 0);

  const planDebts: DebtInput[] = useMemo(
    () =>
      rows
        .filter((r) => r.schedule !== null)
        .map((r) => ({
          id: r.account.id,
          name: r.account.name,
          balance: r.balance,
          annualRatePct: r.account.interestRate!,
          minPayment: r.payment,
          rateSteps: r.steps,
          lumpSums: r.lumpSums,
        })),
    [rows],
  );

  // The lump-sum editor stores native amounts, so it gets each account's own
  // currency -- unlike the plan figures, which are all in the base currency.
  const repaymentDebts = useMemo(
    () =>
      rows
        .filter((r) => r.schedule !== null)
        .map((r) => ({
          id: r.account.id,
          name: r.account.name,
          currency: r.account.currency || base,
        })),
    [rows, base],
  );

  const extraVal = extra.trim() ? parseDecimal(extra) : 0;
  const plan = useMemo(
    () => planPayoff(planDebts, strategy, Number.isFinite(extraVal) ? extraVal : 0, todayIso),
    [planDebts, strategy, extraVal, todayIso],
  );
  // "What if I only ever paid the minimums": no monthly extra AND no lump
  // sums, so the savings line below covers everything the user plans to pay on
  // top, not just the monthly figure.
  const baseline = useMemo(
    () => planPayoff(planDebts.map(({ lumpSums: _drop, ...d }) => d), strategy, 0, todayIso),
    [planDebts, strategy, todayIso],
  );
  const totalLumpSums = rows.reduce((s, r) => s + r.plannedLumpSums, 0);

  // The chart's scope: every debt stacked, or one debt on its own. A selected
  // debt that disappears (deleted account) falls back to "all" rather than
  // rendering an empty chart.
  const scopeId = scope !== ALL && planDebts.some((d) => d.id === scope) ? scope : ALL;
  const chartDebts = useMemo(
    () =>
      (scopeId === ALL ? planDebts : planDebts.filter((d) => d.id === scopeId)).map((d) => ({
        id: d.id,
        name: d.name,
      })),
    [planDebts, scopeId],
  );
  const years = useMemo(
    () => yearlySplit(plan.series, scopeId === ALL ? undefined : scopeId),
    [plan.series, scopeId],
  );

  // The past, as chart rows: one row per date any in-scope debt has a reading
  // on, every debt carried forward to that date. Trimmed by the timeframe, so
  // the strip scopes how far back the chart looks; the forecast beyond today
  // always runs to payoff.
  const historyRows = useMemo(() => {
    const scoped = rows.filter(
      (r) => r.schedule !== null && (scopeId === ALL || r.account.id === scopeId),
    );
    if (scoped.length === 0) return [];
    const earliest = scoped.reduce(
      (min, r) => (r.account.openedOn < min ? r.account.openedOn : min),
      scoped[0].account.openedOn,
    );
    const from = timeframeStart(tf, todayIso, earliest);
    // Monthly, like the forecast: the chart's x-axis is categorical, so a
    // sparse past would compress seven years into the width of one plan month
    // and the whole repayment would read as a cliff at the left edge.
    const dates: string[] = [];
    for (let d = from; d < todayIso; d = addMonthsToDate(d, 1)) dates.push(d);
    for (const r of scoped) {
      for (const p of r.history) if (p.date >= from && p.date < todayIso) dates.push(p.date);
    }
    dates.sort();
    const at = (r: (typeof scoped)[number], date: string) => {
      let value = 0;
      for (const p of r.history) {
        if (p.date > date) break;
        value = p.balance;
      }
      // Before the account existed it owed nothing, not its opening balance.
      return date < r.account.openedOn ? 0 : value;
    };
    // Today closes the measured part and is where the forecast takes over, so
    // it is always a point -- the "today" marker needs one to draw on.
    return [...new Set([...dates, todayIso])].map((date) => ({
      date,
      byDebt: Object.fromEntries(scoped.map((r) => [r.account.id, at(r, date)])),
    }));
  }, [rows, scopeId, tf, todayIso]);
  // A ReferenceLine on a categorical axis only draws when its x matches a
  // data point exactly, and the series lands on today's day-of-month -- so the
  // fixed-rate end date is snapped to the first plan month at or after it
  // instead of silently drawing nothing.
  const markers = useMemo(() => {
    const dates = plan.series.map((p) => p.date);
    const todayMarker =
      historyRows.length > 0 ? [{ date: todayIso, label: t("debt.chart.today") }] : [];
    const snap = (iso: string) => dates.find((d) => d >= iso) ?? dates[dates.length - 1];
    return todayMarker.concat(
      rows
        .filter(
          (r) =>
            r.schedule &&
            r.steps.length > 0 &&
            (scopeId === ALL || r.account.id === scopeId) &&
            r.account.rateFixedUntil! > todayIso,
        )
        .map((r) => ({
          date: snap(r.account.rateFixedUntil!),
          label:
            scopeId === ALL && rows.length > 1
              ? `${r.account.name}: ${t("debt.chart.fixedRateEnd")}`
              : t("debt.chart.fixedRateEnd"),
        })),
    );
  }, [rows, scopeId, todayIso, t, plan.series, historyRows]);

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  const planEntryById = new Map(plan.perDebt.map((p) => [p.id, p]));
  const colorById = new Map(planDebts.map((d, i) => [d.id, debtColor(i)]));
  const debtFreeDate = plan.totalMonths != null ? addMonthsToDate(todayIso, plan.totalMonths) : null;

  return (
    <div className="space-y-6">
      <Card data-tour="debt-totals">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={t("debt.totals.debt")} value={formatCurrency(totalDebt, base)} isPrivate />
          <Stat
            label={t("debt.totals.original")}
            value={formatCurrency(totalOriginal, base)}
            isPrivate
          />
          <Stat
            label={t("debt.totals.repaid")}
            value={formatCurrency(totalRepaid, base)}
            sub={
              totalOriginal > 0
                ? `${formatNumber((totalRepaid / totalOriginal) * 100, 1)}%`
                : undefined
            }
            valueClassName={totalRepaid > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
            isPrivate
          />
          <Stat
            label={t("debt.totals.minPayment")}
            value={formatCurrency(totalMinPayment, base)}
            isPrivate
          />
          <Stat
            label={t("debt.totals.months")}
            value={plan.totalMonths != null ? formatMonths(plan.totalMonths, t) : "—"}
            sub={
              debtFreeDate ? `${t("debt.totals.debtFreeOn")} ${formatDate(debtFreeDate)}` : undefined
            }
          />
          <Stat
            label={t("debt.totals.interestLeft")}
            value={formatCurrency(plan.totalInterest, base)}
            isPrivate
          />
        </div>
      </Card>

      <Card data-tour="debt-list">
        <h2 className="text-lg font-semibold">{t("debt.list.title")}</h2>
        {liabilityAccounts.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("debt.list.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("name")}>
                    {t("debt.list.name")}
                    {arrow("name")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("balance")}>
                    {t("debt.list.balance")}
                    {arrow("balance")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("rate")}>
                    {t("debt.list.rate")}
                    {arrow("rate")}
                  </th>
                  <th className={thCls}>{t("debt.list.fixedUntil")}</th>
                  <th className={`${thCls} text-right`}>{t("debt.list.payment")}</th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("lumpSums")}>
                    {t("debt.list.lumpSums")}
                    {arrow("lumpSums")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("term")}>
                    {t("debt.list.term")}
                    {arrow("term")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("payoffDate")}>
                    {t("debt.list.payoffDate")}
                    {arrow("payoffDate")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(({ account, balance, payment, plannedLumpSums, schedule }) => (
                  <tr
                    key={account.id}
                    className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-3 py-2 font-medium" data-private>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorById.get(account.id) ?? "transparent" }}
                        />
                        {account.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" data-private>
                      {formatCurrency(balance, base)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {account.interestRate != null ? `${account.interestRate}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {account.rateFixedUntil && account.followUpRate != null ? (
                        <>
                          <span className="whitespace-nowrap">
                            {formatDate(account.rateFixedUntil)}
                          </span>
                          <span className="block whitespace-nowrap">
                            {t("debt.list.followUp", { rate: account.followUpRate })}
                          </span>
                        </>
                      ) : (
                        t("debt.list.noFixedPeriod")
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" data-private>
                      {payment > 0 ? formatCurrency(payment, base) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" data-private>
                      {plannedLumpSums > 0 ? formatCurrency(plannedLumpSums, base) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {schedule?.months != null ? formatMonthsShort(schedule.months, t) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {schedule ? (
                        schedule.payoffDate ? (
                          formatDate(schedule.payoffDate)
                        ) : (
                          t("debt.list.neverPaysOff")
                        )
                      ) : (
                        <span className="text-zinc-500">{t("debt.list.needsDetails")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setDetailsFor(account)}>
                        {t("debt.list.editDetails")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {planDebts.length > 0 && (
        <Card data-tour="debt-chart">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t("debt.chart.title")}</h2>
              <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("debt.chart.intro")}</p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <SegmentedControl
                size="sm"
                value={tf}
                onChange={setTf}
                options={TIMEFRAMES.map((x) => ({ label: x, value: x }))}
              />
              {planDebts.length > 1 && (
              <div className="w-full sm:w-64">
                <label className="text-sm font-medium">{t("debt.chart.scopeLabel")}</label>
                <SelectMenu
                  className="mt-1 w-full"
                  ariaLabel={t("debt.chart.scopeLabel")}
                  value={scopeId}
                  onChange={setScope}
                  options={[
                    { value: ALL, label: t("debt.chart.all") },
                    ...planDebts.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </div>
              )}
            </div>
          </div>

          <DebtBalanceChart
            series={plan.series}
            history={historyRows}
            baseline={extraVal > 0 ? baseline.series : undefined}
            debts={chartDebts}
            base={base}
            markers={markers}
          />

          <h3 className="mt-6 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            {t("debt.chart.splitTitle")}
          </h3>
          <DebtSplitChart years={years} base={base} />
        </Card>
      )}

      {planDebts.length > 0 && (
        <Card data-tour="debt-plan">
          <h2 className="text-lg font-semibold">{t("debt.plan.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("debt.plan.intro")}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">{t("debt.plan.strategyLabel")}</label>
              <SelectMenu
                className="mt-1 w-full"
                ariaLabel={t("debt.plan.strategyLabel")}
                value={strategy}
                onChange={(v) => setStrategy(v as DebtStrategy)}
                options={[
                  { value: "avalanche", label: t("debt.plan.strategy.avalanche") },
                  { value: "snowball", label: t("debt.plan.strategy.snowball") },
                ]}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="debt-extra">
                {t("debt.plan.extraLabel", { currency: base })}
              </label>
              <input
                id="debt-extra"
                inputMode="decimal"
                value={extra}
                onChange={(e) => setExtra(stripLeadingZero(e.target.value))}
                placeholder="0"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                data-private
              />
            </div>
          </div>

          <div className="mt-6">
            <DebtRepaymentsPlanner debts={repaymentDebts} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Stat
              label={t("debt.plan.totalMonths")}
              value={plan.totalMonths != null ? formatMonths(plan.totalMonths, t) : "—"}
            />
            <Stat
              label={t("debt.plan.totalInterest")}
              value={formatCurrency(plan.totalInterest, base)}
              isPrivate
            />
          </div>

          {(extraVal > 0 || totalLumpSums > 0) &&
            baseline.totalMonths != null &&
            plan.totalMonths != null && (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
                {t("debt.plan.savings", {
                  months: baseline.totalMonths - plan.totalMonths,
                  amount: formatCurrency(
                    Math.max(0, baseline.totalInterest - plan.totalInterest),
                    base,
                  ),
                })}
              </p>
            )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls}>{t("debt.plan.order")}</th>
                  <th className={thCls}>{t("debt.list.name")}</th>
                  <th className={`${thCls} text-right`}>{t("debt.list.term")}</th>
                  <th className={thCls}>{t("debt.list.payoffDate")}</th>
                  <th className={`${thCls} text-right`}>{t("debt.plan.totalInterest")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.order.map((id, i) => {
                  const entry = planEntryById.get(id);
                  if (!entry) return null;
                  return (
                    <tr
                      key={id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 tabular-nums text-zinc-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium" data-private>
                        {entry.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {entry.payoffMonth != null ? formatMonthsShort(entry.payoffMonth, t) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {entry.payoffMonth != null
                          ? formatDate(addMonthsToDate(todayIso, entry.payoffMonth))
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" data-private>
                        {formatCurrency(entry.totalInterest, base)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detailsFor && (
        <DebtDetailsDialog
          account={detailsFor}
          open={detailsFor !== null}
          onClose={() => setDetailsFor(null)}
        />
      )}
    </div>
  );
}
