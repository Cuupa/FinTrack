"use client";

// Content of the Add-asset modal: a tab to add a holding manually (search by
// ISIN/WKN/symbol) or to import a broker CSV of transactions.

import { useState } from "react";
import { Card, SegmentedControl } from "@/components/ui/primitives";
import { AddAssetForm } from "./add-asset-form";
import { ImportTransactions } from "./import-transactions";
import { useFeature } from "@/lib/flags/flags-context";
import { ProGate } from "@/components/billing/pro-teaser";
import { useI18n } from "@/lib/i18n/i18n-context";

type Tab = "manual" | "import";

export function AddAssetPanel({
  onDone,
  onRun,
}: {
  onDone?: () => void;
  /** Forwarded to ImportTransactions — see its doc comment. */
  onRun?: (job: Promise<void>) => void;
}) {
  const [tab, setTab] = useState<Tab>("manual");
  const { t } = useI18n();
  // With CSV import off, the modal is manual-only — no tab switcher needed.
  // Pro-locked keeps the tab (and its real UI, blurred behind the paywall):
  // hiding the tab would make the feature invisible to exactly the users it
  // is meant to be sold to.
  const { enabled: csvImport, locked: csvLocked } = useFeature("csvImport");
  const activeTab = csvImport ? tab : "manual";
  return (
    <Card>
      {csvImport && (
        <div className="mb-4 max-w-xs">
          <SegmentedControl<Tab>
            value={activeTab}
            onChange={setTab}
            options={[
              { label: t("addAsset.manual"), value: "manual" },
              { label: t("addAsset.import"), value: "import" },
            ]}
          />
        </div>
      )}
      {/* Both panels stay mounted (toggled with `hidden`) so a CSV already
          uploaded on the Import tab isn't lost when switching to Manual and
          back. The manual form is width-capped so it stays readable in the
          wider modal the import view needs. */}
      <div className={activeTab === "manual" ? "mx-auto max-w-2xl" : "hidden"}>
        <AddAssetForm onDone={onDone} embedded />
      </div>
      {csvImport && (
        <div className={activeTab === "import" ? "" : "hidden"}>
          <ProGate locked={csvLocked} feature="csvImport">
            <ImportTransactions onDone={onDone} onRun={onRun} />
          </ProGate>
        </div>
      )}
    </Card>
  );
}
