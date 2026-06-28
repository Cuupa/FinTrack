"use client";

import { RebalancingView } from "@/components/rebalancing/rebalancing-view";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function RebalancingPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("rebalancing.title")}</h1>
        <p className="text-sm text-zinc-500">
          Compare your current allocation to a target and see the trades needed to
          get there.
        </p>
      </div>
      <RebalancingView />
    </div>
  );
}
