"use client";

import { DividendsView } from "@/components/dividends/dividends-view";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function DividendsPage() {
  const { t } = useI18n();
  const enabled = useFeatureFlag("dividends");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("div.title")}</h1>
        <p className="text-sm text-zinc-500">{t("div.subtitle")}</p>
      </div>
      {enabled ? <DividendsView /> : <FeatureUnavailable />}
    </div>
  );
}
