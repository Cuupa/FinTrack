"use client";

// Read-only view of a shared cash-flow Sankey. Chrome is English-by-design like
// the shared portfolio view; the diagram's node labels come baked in the owner's
// locale. A full share shows absolute income/expense/net; an incognito one shows
// only the diagram, with tooltips as a percent of the period's throughput.

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-context";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Card, Stat } from "@/components/ui/primitives";
import { SankeyChart } from "@/components/spending/sankey-chart";
import type { SankeySharePayload } from "@/lib/share/sankey-share";

function periodLabel(payload: SankeySharePayload, locale: string): string {
  if (payload.periodKind !== "month") return payload.period;
  const y = Number(payload.period.slice(0, 4));
  const m = Number(payload.period.slice(5, 7)) - 1;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
    new Date(Date.UTC(y, m, 1)),
  );
}

export function SharedSankeyView({ payload }: { payload: SankeySharePayload }) {
  const { locale } = useI18n();
  const { incognito, currency, graph, labels, income, expense, net } = payload;
  const title = payload.ownerName ? `${payload.ownerName} · Cashflow` : "Cashflow";
  const formatValue = incognito
    ? (v: number) => formatPercent(v)
    : (v: number) => formatCurrency(v, currency);
  const ariaLabel = `Cash-flow Sankey for ${periodLabel(payload, locale)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-zinc-500">
            A read-only snapshot for {periodLabel(payload, locale)}
            {incognito ? " (incognito, amounts hidden)" : ""}.
          </p>
        </div>
        <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-700">
          Snapshot
        </span>
      </div>

      {!incognito && income != null && expense != null && net != null && (
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Income" value={formatCurrency(income, currency)} />
            <Stat label="Expenses" value={formatCurrency(expense, currency)} />
            <Stat
              label="Net"
              value={formatCurrency(net, currency)}
              valueClassName={net < 0 ? "text-red-600 dark:text-red-400" : ""}
            />
          </div>
        </Card>
      )}

      <Card>
        {graph.nodes.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500">No data.</p>
        ) : (
          <SankeyChart graph={graph} labels={labels} formatValue={formatValue} ariaLabel={ariaLabel} />
        )}
      </Card>

      <p className="text-center text-xs text-zinc-400">
        Powered by{" "}
        <Link href="/" className="hover:underline">
          FinTrack
        </Link>
      </p>
    </div>
  );
}
