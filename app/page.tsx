"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { NetWorthHero } from "@/components/dashboard/net-worth-hero";
import { AssetTable } from "@/components/assets/asset-table";
import { AddAssetForm } from "@/components/assets/add-asset-form";
import { Button } from "@/components/ui/primitives";

export default function DashboardPage() {
  const { loading } = usePortfolio();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500">Your portfolio at a glance.</p>
        </div>
        {!adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add asset
          </Button>
        )}
      </div>

      {loading ? (
        <div className="h-[420px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
      ) : (
        <>
          <NetWorthHero />
          {adding && <AddAssetForm onDone={() => setAdding(false)} />}
          <AssetTable />
        </>
      )}
    </div>
  );
}
