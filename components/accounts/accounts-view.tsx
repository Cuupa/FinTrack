"use client";

// Accounts & liabilities (ROADMAP #1, flag `accounts`): balance accounts
// (checking/savings/credit/loan/mortgage/other) beside investments. Assets add
// to net worth, liabilities subtract -- this is the one entity that can push
// net worth below zero. Everything rides the store seam; no mode branching.
//
// Two pieces, composed by app/accounts/page.tsx (round 28):
//   AddAccountForm -- modal content behind the header button, matching how
//                     /portfolio hides "add asset" behind one.
//   AccountsTable  -- the list itself.
// The totals moved to `AccountsHero`, which owns the figure, the account
// picker and the chart; a second copy of "assets / liabilities / net" directly
// under it was the duplication this restructure exists to remove.

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import {
  ACCOUNT_KINDS,
  INTEREST_FREQUENCIES,
  LIABILITY_KINDS,
  type Account,
  type AccountKind,
  type InterestFrequency,
} from "@/lib/types";
import { currentAccountBalance } from "@/lib/finance/accounts";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/i18n-context";
import {
  Table,
  TablePagination,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  usePagination,
} from "@/components/ui/table";
import { useSort } from "@/components/ui/use-sort";
import { isStorageFullError } from "@/lib/store/errors";
import { AccountBalancesDialog } from "./account-balances-dialog";
import { AccountEditDialog } from "./account-edit-dialog";
import { DeleteAction, EditAction, RowActions } from "@/components/ui/row-actions";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "name" | "kind" | "balance";

/** The add-account form. Lives in a modal now, so it closes itself on success
 *  via `onDone` instead of resetting in place. */
export function AddAccountForm({ onDone }: { onDone?: () => void }) {
  const { data, addAccount } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("checking");
  const [currency, setCurrency] = useState(base);
  const [opening, setOpening] = useState("");
  const [openedOn, setOpenedOn] = useState(today());
  // Credit interest, asset accounts only: a liability's rate is edited on /debt.
  const [interestRate, setInterestRate] = useState("");
  const [interestFrequency, setInterestFrequency] = useState<InterestFrequency>("MONTHLY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindLabel = (k: AccountKind) => t(`accounts.kind.${k}` as Parameters<typeof t>[0]);

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
      onDone?.();
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("accounts.form.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-tour="accounts-form">
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
      </div>
      {!LIABILITY_KINDS.includes(kind) && interestRate.trim() !== "" && (
        <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.interestHint")}</p>
      )}
      {LIABILITY_KINDS.includes(kind) && (
        <p className="mt-3 text-sm text-zinc-500">{t("accounts.form.liabilityHint")}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {error && <p className="mr-auto text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button
          variant="primary"
          disabled={busy || !name.trim() || !openedOn}
          onClick={() => void submit()}
        >
          {t("accounts.form.add")}
        </Button>
      </div>
    </div>
  );
}

/** The account list. `selectedIds` only marks the rows the hero is scoped to --
 *  the list always shows every account, since hiding the others would leave no
 *  way back to them. Empty means no filter, so nothing is singled out. */
export function AccountsTable({ selectedIds = [] }: { selectedIds?: string[] }) {
  const { data, deleteAccount } = usePortfolio();
  const { t } = useI18n();
  const base = data.profile.currency;
  const movements = useAccountMovements();

  const { sort, toggle: toggleSort, apply: applySort } = useSort<SortKey>("name");
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
    return applySort(withValues, (r, key) => {
      if (key === "name") return r.account.name;
      if (key === "kind") return kindLabel(r.account.kind);
      return r.signed;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.accounts, data.accountBalances, applySort, movements]);

  const pager = usePagination(rows);

  return (
    <Card data-tour="accounts-list">
      <h2 className="text-lg font-semibold">{t("accounts.list.title")}</h2>
      {data.accounts.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("accounts.list.empty")}</p>
      ) : (
        <>
          <Table className="mt-4">
            <Thead>
              <Th sort={sort} sortKey="name" onSort={toggleSort}>
                {t("accounts.list.name")}
              </Th>
              <Th sort={sort} sortKey="kind" onSort={toggleSort}>
                {t("accounts.list.kind")}
              </Th>
              <Th align="right" sort={sort} sortKey="balance" onSort={toggleSort}>
                {t("accounts.list.balance")}
              </Th>
              <Th />
            </Thead>
            <Tbody>
              {pager.rows.map(({ account, signed }) => {
                const cur = account.currency || base;
                return (
                  <Tr key={account.id} selected={selectedIds.includes(account.id)}>
                    <Td className="font-medium" data-private>
                      {account.name}
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
                    </Td>
                    <Td className="text-zinc-500">{kindLabel(account.kind)}</Td>
                    <Td
                      align="right"
                      className={`tabular-nums ${signed < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                      data-private
                    >
                      {formatCurrency(signed, cur)}
                    </Td>
                    <Td>
                      <RowActions>
                        <EditAction
                          label={t("accounts.list.edit")}
                          onClick={() => setEditing(account)}
                        />
                        {/* Its own affordance, not an edit: a dated balance
                            series is a second entity behind this row. */}
                        <Button size="sm" variant="ghost" onClick={() => setBalancesFor(account)}>
                          {t("accounts.list.editBalances")}
                        </Button>
                        <DeleteAction
                          label={t("accounts.list.delete")}
                          onClick={() => setConfirmDelete(account)}
                        />
                      </RowActions>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
          <TablePagination pager={pager} />
        </>
      )}

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
        message={
          confirmDelete ? t("accounts.delete.message", { name: confirmDelete.name }) : undefined
        }
        confirmLabel={t("accounts.list.delete")}
        onConfirm={() => {
          if (confirmDelete) void deleteAccount(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Card>
  );
}
