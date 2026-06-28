"use client";

import { XrayView } from "@/components/xray/xray-view";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function XrayPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("xray.title")}</h1>
        <p className="text-sm text-zinc-500">
          Your true exposure to individual stocks, looking through your funds.
        </p>
      </div>
      <XrayView />
    </div>
  );
}
