"use client";

import Link from "next/link";
import { useMemo } from "react";

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { dueInterest } from "@/lib/finance/cash-interest";
import { today } from "@/lib/finance/dates";
import { Button, Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export function CashInterestDueCard() {
  const { data } = usePortfolio();
  const { t } = useI18n();
  const enabled = useFeatureFlag("cashInterest");
  const todayIso = today();

  const rows = useMemo(() => {
    if (!enabled) return [];
    return data.assets
      .filter((a) => a.type === "CASH")
      .map((asset) => ({ asset, due: dueInterest(asset, data.transactions, todayIso).length }))
      .filter((r) => r.due > 0);
  }, [enabled, data.assets, data.transactions, todayIso]);

  if (rows.length === 0) return null;

  return (
    <Card>
      <h2 className="text-sm font-semibold">{t("cashInterest.title")}</h2>
      <ul className="mt-3 space-y-2">
        {rows.map(({ asset, due }) => (
          <li
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40"
          >
            <span className="text-sm text-amber-800 dark:text-amber-300" data-private>
              {asset.name}: {t("cashInterest.dueShort", { count: String(due) })}
            </span>
            <Link href={`/assets/${asset.id}`}>
              <Button size="sm" variant="primary">
                {t("cashInterest.review")}
              </Button>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
