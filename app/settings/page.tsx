"use client";

import { useI18n } from "@/lib/i18n/i18n-context";
import { SettingsView } from "@/components/settings/settings-view";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-zinc-500">{t("settings.subtitle")}</p>
      </div>
      <SettingsView />
    </div>
  );
}
