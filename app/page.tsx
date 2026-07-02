"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAuth } from "@/lib/auth/auth-context";
import type { Timeframe } from "@/lib/finance/dates";
import { NetWorthHero } from "@/components/dashboard/net-worth-hero";
import { AssetTable } from "@/components/assets/asset-table";
import { AddAssetForm } from "@/components/assets/add-asset-form";
import { ExportMenu } from "@/components/dashboard/export-menu";
import { ShareMenu } from "@/components/dashboard/share-menu";
import { LiveShareSync } from "@/components/dashboard/live-share-sync";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function DashboardPage() {
  const { loading } = usePortfolio();
  const { mode } = useAuth();
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  // Shared so the holdings table's profit column tracks the hero chart timeframe.
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-zinc-500">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ShareMenu />
          {/* Registered users export from the profile menu; guests (no profile
              menu) keep the standalone export button here. */}
          {mode !== "registered" && <ExportMenu />}
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
          <NetWorthHero timeframe={timeframe} onTimeframe={setTimeframe} />
          <AssetTable timeframe={timeframe} />
        </>
      )}

      {/* Add-asset opens in a modal so it appears right where you clicked,
          not buried at the bottom of the page. */}
      <Modal open={adding} onClose={() => setAdding(false)}>
        <AddAssetForm onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
