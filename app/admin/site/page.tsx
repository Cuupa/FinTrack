"use client";

// Site-config editor: the operator-identity keys shown on the legal pages
// (`site_config`, world-readable) plus the registration cap
// (`app_settings.max_users`, not client-readable — RLS enables the table
// with no select policy at all, so its current value comes from GET
// /api/admin/site). Both save through POST /api/admin/site.
//
// Reuses useSiteConfig() (lib/site-config.ts) for the current values instead
// of a bespoke fetch: it already paints the localStorage-cached values
// immediately and revalidates from Supabase in the background, and every
// public page using the same hook (app/impressum, app/datenschutz) picks up
// a saved change the next time it fetches — no extra wiring needed here to
// "push" the new value into that cache.

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useSiteConfig } from "@/lib/site-config";
import { SITE_CONFIG_KEYS, type SiteConfigKey } from "@/lib/site-config-cache";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { adminAuthToken, adminGet, adminPost } from "@/lib/admin/client";

interface AppSettings {
  maxUsers: number | null;
  updatedAt: string | null;
}

export default function AdminSitePage() {
  const { t } = useI18n();
  const { config, loaded } = useSiteConfig();

  // Per-key draft overrides the loaded value once the admin edits a field;
  // the input's displayed value is `drafts[key] ?? config[key] ?? ""`, same
  // "derive the default, don't sync it via effect" technique as
  // app/admin/flags/page.tsx's `selectedFlag`.
  const [drafts, setDrafts] = useState<Partial<Record<SiteConfigKey, string>>>({});
  const [savingKey, setSavingKey] = useState<SiteConfigKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [maxUsersDraft, setMaxUsersDraft] = useState<string | null>(null);
  const [savingMaxUsers, setSavingMaxUsers] = useState(false);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const token = await adminAuthToken();
      if (!token || !active) return;
      try {
        const body = await adminGet<AppSettings>("/api/admin/site", token);
        if (active) setSettings(body);
      } catch {
        // Leave settings null — the max-users field shows its skeleton.
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [settingsVersion]);

  const saveConfig = async (key: SiteConfigKey) => {
    const value = drafts[key] ?? config[key] ?? "";
    setSavingKey(key);
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost("/api/admin/site", { kind: "config", key, value }, token);
    } catch {
      setError(t("admin.site.error"));
    } finally {
      setSavingKey(null);
    }
  };

  const maxUsersValue = maxUsersDraft ?? (settings?.maxUsers != null ? String(settings.maxUsers) : "");

  const saveMaxUsers = async () => {
    const trimmed = maxUsersValue.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setError(t("admin.site.maxUsersInvalid"));
      return;
    }
    setSavingMaxUsers(true);
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost("/api/admin/site", { kind: "maxUsers", value }, token);
      setSettingsVersion((v) => v + 1);
    } catch {
      setError(t("admin.site.error"));
    } finally {
      setSavingMaxUsers(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.site.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.site.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.site.configTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.site.configSubtitle")}</p>

        {!loaded && Object.keys(config).length === 0 ? (
          <div className="mt-4 space-y-3">
            {SITE_CONFIG_KEYS.map((key) => (
              <Skeleton key={key} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {SITE_CONFIG_KEYS.map((key) => {
              const value = drafts[key] ?? config[key] ?? "";
              return (
                <div key={key} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1">
                    <label className="block text-xs text-zinc-500">
                      {t(`admin.site.key.${key}`)}
                    </label>
                    <input
                      value={value}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [key]: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => saveConfig(key)}
                    disabled={savingKey === key}
                  >
                    {t("admin.site.save")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.site.settingsTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.site.maxUsersHint")}</p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[160px]">
            <label className="block text-xs text-zinc-500">{t("admin.site.maxUsersLabel")}</label>
            {settings === null && settingsVersion === 0 ? (
              <Skeleton className="mt-1 h-9 w-32" />
            ) : (
              <input
                type="number"
                min={0}
                step={1}
                value={maxUsersValue}
                onChange={(e) => setMaxUsersDraft(e.target.value)}
                placeholder={t("admin.site.maxUsersPlaceholder")}
                className="mt-1 w-32 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            )}
          </div>
          <Button variant="secondary" onClick={saveMaxUsers} disabled={savingMaxUsers}>
            {t("admin.site.save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
