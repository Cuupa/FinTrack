"use client";

// Read-only history for legacy statement readings. New balance changes belong
// in the booking journal so the account never changes without a transaction.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import type { Account } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
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

export function AccountBalancesDialog({
  account,
  open,
  onClose,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
}) {
  const { data } = usePortfolio();
  const { t } = useI18n();
  const cur = account.currency || data.profile.currency;

  const points = useMemo(
    () => data.accountBalances.filter((b) => b.accountId === account.id),
    [data.accountBalances, account.id],
  );

  const sort = useSort<"date" | "balance">("date", "desc");

  const sortedRows = useMemo(
    () => sort.apply(points, (p, key) => (key === "date" ? p.date : p.balance)),
    [points, sort],
  );

  const pager = usePagination(sortedRows);

  return (
    <Modal open={open} onClose={onClose}>
      <Card>
        <h2 className="text-lg font-semibold" data-private>
          {t("accounts.balances.title", { name: account.name })}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("accounts.balances.readOnlyIntro")}</p>

        <p className="mt-3 text-sm text-zinc-500">
          {t("accounts.balances.opening", {
            value: formatCurrency(account.openingBalance, cur),
            date: formatDate(account.openedOn),
          })}
        </p>

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
                    <Td />
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
