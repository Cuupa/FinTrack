"use client";

// Debt payoff planner (ROADMAP #9, flag `debtPayoff`): liability accounts
// (ROADMAP #1) gain amortisation. Interest rate, fixed-rate period and minimum
// payment are part of the ACCOUNT (AccountEditDialog); this view turns them
// into a per-debt schedule, an avalanche/snowball extra-payment simulator and
// the charts that make the decades-long shape of a mortgage legible
// (lib/finance/debt.ts). Everything rides the store seam via usePortfolio();
// no mode branching.
//
// Planned one-off repayments sit in the plan card next to the extra monthly
// payment (`DebtRepaymentsPlanner`), because they are a what-if input of this
// simulation -- a repayment actually made is a transfer on the accounts page.
// Like the extra monthly payment they are LIVE and never stored (owner rule):
// the `lumpSums` state below is the whole of their existence.
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
import { Card, SegmentedControl, Stat } from "@/components/ui/primitives";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { AccountEditDialog } from "@/components/accounts/account-edit-dialog";
import { DebtRepaymentsPlanner, type PlannedRepayment } from "./debt-repayments";
import { DebtBalanceChart, DebtSplitChart, debtColor } from "./debt-chart";
import { EditAction, RowActions } from "@/components/ui/row-actions";

type SortKey = "order" | "name" | "balance" | "rate" | "term" | "interest";

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

  // What-if lump sums, in each account's own currency. Declared before `rows`
  // because the memo below reads them.
  const [lumpSums, setLumpSums] = useState<PlannedRepayment[]>([]);

  const rows = useMemo(() => {
    return liabilityAccounts.map((account) => {
      const rate = accountFxRate(account, valuation);
      const balance = currentAccountBalance(account, data.accountBalances, movements) * rate;
      const hasSchedule = account.interestRate != null && account.minPayment != null;
      const steps = accountRateSteps(account);
      // Planned lump sums, converted to the base currency like the instalment.
      // Ones dated in the past are already inside the balance above, so the
      // schedule drops them (lumpSumsByMonth) rather than paying them twice.
      const accountLumpSums = lumpSums
        .filter((r) => r.accountId === account.id)
        .map((r) => ({ date: r.date, amount: r.amount * rate }));
      const schedule = hasSchedule
        ? amortizationSchedule(
            balance,
            account.interestRate!,
            account.minPayment! * rate,
            todayIso,
            steps,
            accountLumpSums,
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
        lumpSums: accountLumpSums,
        plannedLumpSums: accountLumpSums
          .filter((l) => l.date >= todayIso)
          .reduce((s, l) => s + l.amount, 0),
        schedule,
      };
    });
  }, [liabilityAccounts, data.accountBalances, lumpSums, valuation, todayIso, movements]);

  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("order");
  const [detailsFor, setDetailsFor] = useState<Account | null>(null);
  // How far back the chart reaches. The same strip the depot chart uses, for
  // the same reason: "from today" answers nothing about a debt you have been
  // paying for eight years.
  const [tf, setTf] = useState<Timeframe>("1Y");
  const [strategy, setStrategy] = useState<DebtStrategy>("avalanche");
  const [extra, setExtra] = useState("");
  const [scope, setScope] = useState<string>(ALL);

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

  // The lump-sum editor takes native amounts, so it gets each account's own
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

  // One table, not two: the payoff order used to be its own card repeating
  // name, term and payoff date. It is a column here instead.
  const planEntryById = useMemo(
    () => new Map(plan.perDebt.map((p) => [p.id, p])),
    [plan.perDebt],
  );
  const sortedRows = useMemo(
    () =>
      applySort(rows, (r, key) => {
        if (key === "order") {
          const i = plan.order.indexOf(r.account.id);
          return i === -1 ? null : i;
        }
        if (key === "name") return r.account.name;
        if (key === "balance") return r.balance;
        if (key === "rate") return r.account.interestRate;
        if (key === "interest") return planEntryById.get(r.account.id)?.totalInterest;
        return r.schedule?.months;
      }),
    [rows, applySort, plan.order, planEntryById],
  );

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


  const colorById = new Map(planDebts.map((d, i) => [d.id, debtColor(i)]));
  const debtFreeDate = plan.totalMonths != null ? addMonthsToDate(todayIso, plan.totalMonths) : null;

  return (
    <div className="space-y-6">
      {/* Four figures, not six: "originally borrowed" and "repaid so far" are
          two readings of the same fact, so they ride along under the balance
          they explain. */}
      <Card data-tour="debt-totals">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t("debt.totals.debt")}
            value={formatCurrency(totalDebt, base)}
            isPrivate
            sub={
              totalOriginal > 0
                ? t("debt.totals.repaidOf", {
                    repaid: formatCurrency(totalRepaid, base),
                    original: formatCurrency(totalOriginal, base),
                    pct: formatNumber((totalRepaid / totalOriginal) * 100, 1),
                  })
                : undefined
            }
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

      {/* The plan and the chart it moves, together and above the table: the
          levers are the point of this page, and they used to sit two cards
          below the thing they change. */}
      {planDebts.length > 0 && (
        <Card data-tour="debt-plan">
          <h2 className="text-lg font-semibold">{t("debt.plan.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("debt.plan.intro")}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            {planDebts.length > 1 && (
              <div>
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

          <div className="mt-6">
            <DebtRepaymentsPlanner
              debts={repaymentDebts}
              value={lumpSums}
              onChange={setLumpSums}
            />
          </div>

          {(extraVal > 0 || totalLumpSums > 0) &&
            baseline.totalMonths != null &&
            plan.totalMonths != null && (
              <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">
                {t("debt.plan.savings", {
                  months: baseline.totalMonths - plan.totalMonths,
                  amount: formatCurrency(
                    Math.max(0, baseline.totalInterest - plan.totalInterest),
                    base,
                  ),
                })}
              </p>
            )}

          <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800" data-tour="debt-chart">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t("debt.chart.title")}</h3>
              <SegmentedControl
                size="sm"
                value={tf}
                onChange={setTf}
                options={TIMEFRAMES.map((x) => ({ label: x, value: x }))}
              />
            </div>
            <DebtBalanceChart
              series={plan.series}
              history={historyRows}
              baseline={extraVal > 0 ? baseline.series : undefined}
              debts={chartDebts}
              base={base}
              markers={markers}
            />
          </div>
        </Card>
      )}

      <Card data-tour="debt-list">
        <h2 className="text-lg font-semibold">{t("debt.list.title")}</h2>
        {liabilityAccounts.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("debt.list.empty")}</p>
        ) : (
          <Table className="mt-4">
            <Thead>
              <Th sort={sort} sortKey="order" onSort={toggleSort}>
                {t("debt.plan.order")}
              </Th>
              <Th sort={sort} sortKey="name" onSort={toggleSort}>
                {t("debt.list.name")}
              </Th>
              <Th align="right" sort={sort} sortKey="balance" onSort={toggleSort}>
                {t("debt.list.balance")}
              </Th>
              <Th align="right" sort={sort} sortKey="rate" onSort={toggleSort}>
                {t("debt.list.rate")}
              </Th>
              <Th align="right">{t("debt.list.payment")}</Th>
              <Th align="right" sort={sort} sortKey="term" onSort={toggleSort}>
                {t("debt.list.term")}
              </Th>
              <Th align="right" sort={sort} sortKey="interest" onSort={toggleSort}>
                {t("debt.list.interest")}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {sortedRows.map(({ account, balance, payment, schedule }) => {
                const order = plan.order.indexOf(account.id);
                const entry = planEntryById.get(account.id);
                return (
                  <Tr key={account.id}>
                    <Td className="tabular-nums text-zinc-500">{order >= 0 ? order + 1 : "—"}</Td>
                    <Td className="font-medium" data-private>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorById.get(account.id) ?? "transparent" }}
                        />
                        {account.name}
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums" data-private>
                      {formatCurrency(balance, base)}
                    </Td>
                    {/* The follow-up rate rides under the rate it replaces,
                        instead of costing a column of its own. */}
                    <Td align="right" className="tabular-nums">
                      {account.interestRate != null ? `${account.interestRate}%` : "—"}
                      {account.rateFixedUntil && account.followUpRate != null && (
                        <span className="block whitespace-nowrap text-xs text-zinc-500">
                          {formatDate(account.rateFixedUntil)}
                          {" · "}
                          {t("debt.list.followUp", { rate: account.followUpRate })}
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="tabular-nums" data-private>
                      {payment > 0 ? formatCurrency(payment, base) : "—"}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {schedule ? (
                        schedule.months != null ? (
                          <>
                            {formatMonthsShort(schedule.months, t)}
                            {schedule.payoffDate && (
                              <span className="block whitespace-nowrap text-xs text-zinc-500">
                                {formatDate(schedule.payoffDate)}
                              </span>
                            )}
                          </>
                        ) : (
                          t("debt.list.neverPaysOff")
                        )
                      ) : (
                        <span className="text-zinc-500">{t("debt.list.needsDetails")}</span>
                      )}
                    </Td>
                    <Td align="right" className="tabular-nums" data-private>
                      {entry ? formatCurrency(entry.totalInterest, base) : "—"}
                    </Td>
                    <Td align="right">
                      <RowActions>
                        <EditAction
                          label={t("accounts.list.edit")}
                          onClick={() => setDetailsFor(account)}
                        />
                      </RowActions>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      {planDebts.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("debt.chart.splitTitle")}</h2>
          <DebtSplitChart years={years} base={base} />
        </Card>
      )}

      {/* The terms live on the account itself, so editing them opens the very
          form the account was created with -- this page visualises them. */}
      {detailsFor && (
        <AccountEditDialog
          account={detailsFor}
          open={detailsFor !== null}
          onClose={() => setDetailsFor(null)}
        />
      )}
    </div>
  );
}
