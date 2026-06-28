"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { NetWorthHero } from "@/components/dashboard/net-worth-hero";
import { AssetTable } from "@/components/assets/asset-table";
import { AddAssetForm } from "@/components/assets/add-asset-form";
import { ExportMenu } from "@/components/dashboard/export-menu";
import { ShareMenu } from "@/components/dashboard/share-menu";
import { LiveShareSync } from "@/components/dashboard/live-share-sync";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function DashboardPage() {
  const { loading } = usePortfolio();
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-zinc-500">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ShareMenu />
          <ExportMenu />
          {!adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              {t("dashboard.addAsset")}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-[420px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      ) : (
        <>
          <LiveShareSync />
          <NetWorthHero />
          {adding && <AddAssetForm onDone={() => setAdding(false)} />}
          <AssetTable />
        </>
      )}
    </div>
  );
}
