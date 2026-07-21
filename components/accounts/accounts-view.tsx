"use client";

// Accounts & liabilities surface (ROADMAP #1, flag `accounts`): the net-worth
// home where balance accounts (checking/savings/credit/loan/mortgage/other) sit
// beside investments. Assets add to net worth, liabilities subtract — this is
// the one entity that can push net worth below zero. Everything rides the store
// seam via usePortfolio(); no mode branching.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { today } from "@/lib/finance/dates";
import {
  ACCOUNT_KINDS,
  LIABILITY_KINDS,
  type Account,
  type AccountKind,
} from "@/lib/types";
import { accountsTotals, currentAccountBalance } from "@/lib/finance/accounts";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card, Stat } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";
import { AccountBalancesDialog } from "./account-balances-dialog";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "name" | "kind" | "balance";

export function AccountsView() {
  const { data, addAccount, deleteAccount } = usePortfolio();
  const { valuation } = useLivePrices();
  const { t } = useI18n();
  const base = data.profile.currency;

  const totals = useMemo(
    () => accountsTotals(data.accounts, data.accountBalances, valuation),
    [data.accounts, data.accountBalances, valuation],
  );

  // Add-account form state.
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("checking");
  const [currency, setCurrency] = useState(base);
  const [opening, setOpening] = useState("");
  const [openedOn, setOpenedOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [balancesFor, setBalancesFor] = useState<Account | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);

  const kindLabel = (k: AccountKind) => t(`accounts.kind.${k}` as Parameters<typeof t>[0]);

  const rows = useMemo(() => {
    const withValues = data.accounts.map((a) => {
      const magnitude = currentAccountBalance(a, data.accountBalances);
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
  }, [data.accounts, data.accountBalances, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  async function submit() {
    const trimmed = name.trim();
    const openingVal = parseDecimal(opening);
    if (!trimmed || !openedOn || !Number.isFinite(openingVal)) return;
    setBusy(true);
    setError(null);
    try {
      const cur = currency.trim().toUpperCase();
      await addAccount({
        name: trimmed,
        kind,
        currency: !cur || cur === base ? null : cur,
        isLiability: LIABILITY_KINDS.includes(kind),
        openingBalance: openingVal,
        openedOn,
      });
      setName("");
      setOpening("");
      setKind("checking");
      setCurrency(base);
      setOpenedOn(today());
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("accounts.form.error"));
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
      </Card>

      <Card>
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
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={busy || !name.trim() || !opening.trim() || !openedOn}
              onClick={() => void submit()}
            >
              {t("accounts.form.add")}
            </Button>
          </div>
        </div>
        {LIABILITY_KINDS.includes(kind) && (
          <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.liabilityHint")}</p>
        )}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </Card>

      <Card>
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
                {rows.map(({ account, signed }) => {
                  const cur = account.currency || base;
                  return (
                    <tr
                      key={account.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-medium" data-private>
                        {account.name}
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
