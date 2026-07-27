"use client";

// Accounts & liabilities surface (ROADMAP #1, flag `accounts`): the net-worth
// home where balance accounts (checking/savings/credit/loan/mortgage/other) sit
// beside investments. Assets add to net worth, liabilities subtract — this is
// the one entity that can push net worth below zero. Everything rides the store
// seam via usePortfolio(); no mode branching.

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import {
  ACCOUNT_KINDS,
  INTEREST_FREQUENCIES,
  LIABILITY_KINDS,
  type Account,
  type AccountKind,
  type InterestFrequency,
} from "@/lib/types";
import { accountsTotals, currentAccountBalance } from "@/lib/finance/accounts";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { TablePagination, usePagination } from "@/components/ui/table";
import { isStorageFullError } from "@/lib/store/errors";
import { AccountBalancesDialog } from "./account-balances-dialog";
import { AccountEditDialog } from "./account-edit-dialog";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "name" | "kind" | "balance";

export function AccountsView() {
  const { data, addAccount, deleteAccount } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;

  const movements = useAccountMovements();

  const totals = useMemo(
    () => accountsTotals(data.accounts, data.accountBalances, valuation, movements),
    [data.accounts, data.accountBalances, valuation, movements],
  );

  // Add-account form state.
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("checking");
  const [currency, setCurrency] = useState(base);
  const [opening, setOpening] = useState("");
  const [openedOn, setOpenedOn] = useState(today());
  // Credit interest, asset accounts only: a liability's rate belongs to the
  // payoff planner and is edited there (/debt), so there is exactly one place
  // writing each direction's rate.
  const [interestRate, setInterestRate] = useState("");
  const [interestFrequency, setInterestFrequency] = useState<InterestFrequency>("MONTHLY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [balancesFor, setBalancesFor] = useState<Account | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);

  const kindLabel = (k: AccountKind) => t(`accounts.kind.${k}` as Parameters<typeof t>[0]);

  const rows = useMemo(() => {
    const withValues = data.accounts.map((a) => {
      const magnitude = currentAccountBalance(a, data.accountBalances, movements);
      const signed = a.isLiability ? -magnitude : magnitude;
      return { account: a, signed };
    });
    withValues.sort((x, y) => {
      let cmp = 0;
      if (sort.key === "name") cmp = x.account.name.localeCompare(y.account.name);
      else if (sort.key === "kind") cmp = kindLabel(x.account.kind).localeCompare(kindLabel(y.account.kind));
      else cmp = x.signed - y.signed;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return withValues;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.accounts, data.accountBalances, sort, movements]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  async function submit() {
    const trimmed = name.trim();
    const openingVal = opening.trim() ? parseDecimal(opening) : 0;
    if (!trimmed || !openedOn) return;
    // Never drop an unparseable amount silently: "250.000,00" used to reach
    // here as NaN and the button did nothing at all.
    if (!Number.isFinite(openingVal)) {
      setError(t("common.invalidAmount"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cur = currency.trim().toUpperCase();
      const isLiability = LIABILITY_KINDS.includes(kind);
      // A rate typed before switching to a liability kind is dropped, not
      // saved into the payoff planner's field behind the user's back.
      const rate = !isLiability && interestRate.trim() ? parseDecimal(interestRate) : null;
      if (rate !== null && !Number.isFinite(rate)) {
        setError(t("common.invalidAmount"));
        setBusy(false);
        return;
      }
      await addAccount({
        name: trimmed,
        kind,
        currency: !cur || cur === base ? null : cur,
        isLiability,
        openingBalance: openingVal,
        openedOn,
        interestRate: rate,
        interestFrequency: rate ? interestFrequency : null,
      });
      setName("");
      setOpening("");
      setKind("checking");
      setCurrency(base);
      setOpenedOn(today());
      setInterestRate("");
      setInterestFrequency("MONTHLY");
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("accounts.form.error"));
    } finally {
      setBusy(false);
    }
  }

  const pager = usePagination(rows);

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="space-y-6">
      <Card data-tour="accounts-totals">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label={t("accounts.totals.assets")} value={formatCurrency(totals.assets, base)} isPrivate />
          <Stat
            label={t("accounts.totals.liabilities")}
            value={formatCurrency(totals.liabilities, base)}
            valueClassName={totals.liabilities > 0 ? "text-red-600 dark:text-red-400" : ""}
            isPrivate
          />
          <Stat
            label={t("accounts.totals.net")}
            value={formatCurrency(totals.net, base)}
            valueClassName={totals.net < 0 ? "text-red-600 dark:text-red-400" : ""}
            isPrivate
          />
        </div>

        {/* "Netto" here and "Nettovermögen" on the dashboard are the same idea
            computed in two places, which is exactly what made the areas read as
            unrelated. Say the relation out loud and link it. */}
        <p className="mt-4 border-t border-zinc-200 pt-3 text-sm text-zinc-500 dark:border-zinc-800">
          {t("accounts.totals.partOfNetWorth")}{" "}
          <Link
            href="/"
            className="font-medium text-zinc-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 dark:text-zinc-200 dark:focus-visible:outline-emerald-400"
          >
            {t("stat.netWorth")}
          </Link>
        </p>
      </Card>

      <Card data-tour="accounts-form">
        <h2 className="text-lg font-semibold">{t("accounts.form.title")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("accounts.form.intro")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="text-sm font-medium" htmlFor="account-name">
              {t("accounts.form.nameLabel")}
            </label>
            <input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("accounts.form.namePlaceholder")}
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
            <label className="text-sm font-medium" htmlFor="account-currency">
              {t("accounts.form.currencyLabel")}
            </label>
            <input
              id="account-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              placeholder={base}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="account-opening">
              {t("accounts.form.openingLabel", { currency: currency.trim() || base })}
            </label>
            <input
              id="account-opening"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="account-opened">
              {t("accounts.form.openedLabel")}
            </label>
            <input
              id="account-opened"
              type="date"
              value={openedOn}
              max={today()}
              onChange={(e) => setOpenedOn(e.target.value)}
              className={inputCls}
            />
          </div>
          {/* Credit interest: only for accounts that EARN it. A liability's
              rate drives the payoff schedule and is edited on /debt. */}
          {!LIABILITY_KINDS.includes(kind) && (
            <>
              <div>
                <label className="text-sm font-medium" htmlFor="account-interest">
                  {t("accounts.form.interestLabel")}
                </label>
                <input
                  id="account-interest"
                  inputMode="decimal"
                  value={interestRate}
                  onChange={(e) => setInterestRate(stripLeadingZero(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
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
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={busy || !name.trim() || !openedOn}
              onClick={() => void submit()}
            >
              {t("accounts.form.add")}
            </Button>
          </div>
        </div>
        {!LIABILITY_KINDS.includes(kind) && interestRate.trim() !== "" && (
          <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.interestHint")}</p>
        )}
        {LIABILITY_KINDS.includes(kind) && (
          <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.liabilityHint")}</p>
        )}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </Card>

      <Card data-tour="accounts-list">
        <h2 className="text-lg font-semibold">{t("accounts.list.title")}</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{t("accounts.list.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("name")}>
                    {t("accounts.list.name")}
                    {arrow("name")}
                  </th>
                  <th className={thCls} onClick={() => toggleSort("kind")}>
                    {t("accounts.list.kind")}
                    {arrow("kind")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("balance")}>
                    {t("accounts.list.balance")}
                    {arrow("balance")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pager.rows.map(({ account, signed }) => {
                  const cur = account.currency || base;
                  return (
                    <tr
                      key={account.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-medium" data-private>
                        {account.name}
                        {/* Interest changes the balance without anybody
                            booking anything, so the row says it does. */}
                        {!account.isLiability && (account.interestRate ?? 0) > 0 && (
                          <div className="text-xs font-normal text-zinc-500">
                            {t("accounts.list.interest", {
                              rate: String(account.interestRate),
                              frequency: t(
                                `cashInterest.freq.${account.interestFrequency ?? "MONTHLY"}` as Parameters<
                                  typeof t
                                >[0],
                              ),
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-500">{kindLabel(account.kind)}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          signed < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}
                        data-private
                      >
                        {formatCurrency(signed, cur)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(account)}>
                            {t("accounts.list.edit")}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setBalancesFor(account)}>
                            {t("accounts.list.editBalances")}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(account)}>
                            {t("accounts.list.delete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination pager={pager} />
          </div>
        )}
      </Card>

      {balancesFor && (
        <AccountBalancesDialog
          account={balancesFor}
          open={balancesFor !== null}
          onClose={() => setBalancesFor(null)}
        />
      )}

      {editing && (
        // Keyed on the id so reopening for another account remounts the form
        // with that account's values instead of keeping the first one's state.
        <AccountEditDialog
          key={editing.id}
          account={editing}
          open={editing !== null}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("accounts.delete.title")}
        message={confirmDelete ? t("accounts.delete.message", { name: confirmDelete.name }) : undefined}
        confirmLabel={t("accounts.list.delete")}
        onConfirm={() => {
          if (confirmDelete) void deleteAccount(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
