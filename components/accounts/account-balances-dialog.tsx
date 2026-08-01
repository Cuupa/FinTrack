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
import { DeleteAction, RowActions } from "@/components/ui/row-actions";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

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
  const sort = useSort<"date" | "balance">("date", "desc");

  const sortedRows = useMemo(
    () => sort.apply(points, (p, key) => (key === "date" ? p.date : p.balance)),
    [points, sort],
  );

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
    if (!date) return;
    // An unparseable amount used to return silently, so clicking "add" did
    // nothing and said nothing (a balance typed as "250.000,00" hit this).
    if (!Number.isFinite(v)) {
      setError(t("common.invalidAmount"));
      return;
    }
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

  const pager = usePagination(sortedRows);

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
          <div className="mt-4">
            <Table>
              <Thead>
                <Th sort={sort.sort} sortKey="date" onSort={sort.toggle}>
                  {t("accounts.balances.dateLabel")}
                </Th>
                <Th align="right" sort={sort.sort} sortKey="balance" onSort={sort.toggle}>
                  {t("accounts.balances.valueLabel", { currency: cur })}
                </Th>
                <Th />
              </Thead>
              <Tbody>
                {pager.rows.map((p) => (
                  <Tr key={p.date}>
                    <Td>{formatDate(p.date)}</Td>
                    <Td align="right" className="tabular-nums" data-private>
                      {formatCurrency(p.balance, cur)}
                    </Td>
                    <Td align="right">
                      <RowActions>
                        <DeleteAction
                          label={t("accounts.balances.remove")}
                          onClick={() => void remove(p.date)}
                          disabled={busy}
                        />
                      </RowActions>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <TablePagination pager={pager} />
          </div>
        )}
      </Card>
    </Modal>
  );
}
