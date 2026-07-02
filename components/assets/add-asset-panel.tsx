"use client";

// Content of the Add-asset modal: a tab to add a holding manually (search by
// ISIN/WKN/symbol) or to import a broker CSV of transactions.

import { useState } from "react";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { AddAssetForm } from "./add-asset-form";
import { ImportTransactions } from "./import-transactions";
import { useI18n } from "@/lib/i18n/i18n-context";

type Tab = "manual" | "import";

export function AddAssetPanel({ onDone }: { onDone?: () => void }) {
  const [tab, setTab] = useState<Tab>("manual");
  const { t } = useI18n();
  return (
    <Card>
      <div className="mb-4 max-w-xs">
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { label: t("addAsset.manual"), value: "manual" },
            { label: t("addAsset.import"), value: "import" },
          ]}
        />
      </div>
      {tab === "manual" ? (
        <AddAssetForm onDone={onDone} embedded />
      ) : (
        <ImportTransactions onDone={onDone} />
      )}
    </Card>
  );
}
