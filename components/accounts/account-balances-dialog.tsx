"use client";

// Dated balance editor for one account (ROADMAP #1, flag `accounts`): the user
// records the account's balance on any date. Together with the opening balance
// these form a carry-forward step series (lib/finance/accounts.ts) that feeds
// net worth. Readings ride the store seam via `setAccountBalances` (replace-set,
// so each edit writes the whole set) exactly like OTHER-asset valuation points.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { today } from "@/lib/finance/dates";
import type { Account } from "@/lib/types";
import { formatCurrency, formatDate, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

type SortKey = "date" | "balance";

export function AccountBalancesDialog({
  account,
  open,
  onClose,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
}) {
  const { data, setAccountBalances } = usePortfolio();
  const { t } = useI18n();
  const cur = account.currency || data.profile.currency;

  const points = useMemo(
    () => data.accountBalances.filter((b) => b.accountId === account.id),
    [data.accountBalances, account.id],
  );

  const [date, setDate] = useState(today());
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });

  const sortedRows = useMemo(() => {
    const rows = [...points];
    rows.sort((a, b) => {
      const cmp =
        sort.key === "date"
          ? a.date < b.date
            ? -1
            : a.date > b.date
              ? 1
              : 0
          : a.balance - b.balance;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [points, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  // Replace-set: `next` is the whole set of {date, balance} for this account.
  async function persist(next: { date: string; balance: number }[]) {
    setBusy(true);
    setError(null);
    try {
      await setAccountBalances(account.id, next);
      return true;
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("accounts.balances.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const v = parseDecimal(value);
    if (!date || !Number.isFinite(v)) return;
    // Upsert by date: a new balance on an existing date overwrites it.
    const next = points
      .filter((p) => p.date !== date)
      .map((p) => ({ date: p.date, balance: p.balance }));
    next.push({ date, balance: v });
    if (await persist(next)) setValue("");
  }

  async function remove(pointDate: string) {
    const next = points
      .filter((p) => p.date !== pointDate)
      .map((p) => ({ date: p.date, balance: p.balance }));
    await persist(next);
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const thCls =
    "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200";

  return (
    <Modal open={open} onClose={onClose}>
      <Card>
        <h2 className="text-lg font-semibold" data-private>
          {t("accounts.balances.title", { name: account.name })}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("accounts.balances.intro")}</p>

        <p className="mt-3 text-sm text-zinc-500">
          {t("accounts.balances.opening", {
            value: formatCurrency(account.openingBalance, cur),
            date: formatDate(account.openedOn),
          })}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="text-sm font-medium" htmlFor="balance-date">
              {t("accounts.balances.dateLabel")}
            </label>
            <input
              id="balance-date"
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="balance-value">
              {t("accounts.balances.valueLabel", { currency: cur })}
            </label>
            <input
              id="balance-value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(stripLeadingZero(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              placeholder="0"
              className={inputCls}
              data-private
            />
          </div>
          <Button variant="primary" disabled={busy || !date || !value.trim()} onClick={() => void add()}>
            {t("accounts.balances.add")}
          </Button>
        </div>

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {points.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t("accounts.balances.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={thCls} onClick={() => toggleSort("date")}>
                    {t("accounts.balances.dateLabel")}
                    {arrow("date")}
                  </th>
                  <th className={`${thCls} text-right`} onClick={() => toggleSort("balance")}>
                    {t("accounts.balances.valueLabel", { currency: cur })}
                    {arrow("balance")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((p) => (
                  <tr
                    key={p.date}
                    className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-3 py-2">{formatDate(p.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" data-private>
                      {formatCurrency(p.balance, cur)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(p.date)}
                        disabled={busy}
                        aria-label={t("accounts.balances.remove")}
                        className="text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Modal>
  );
}
