"use client";

// Admin overview: four health tiles computed client-side from data the admin
// can already read directly: `instruments` and `feature_flags` are
// world-readable (same tables app/admin/prices/page.tsx and
// app/admin/flags/page.tsx already query straight from the browser client),
// `error_logs` is admin-readable under RLS (migration 0051), and the site
// config completeness reuses useSiteConfig() rather than a bespoke fetch.
// No new API routes: everything here is a read, and every table involved
// already has a policy that covers an authenticated admin.
//
// Each tile links to the section that owns the underlying detail view
// (admin/prices, admin/errors, admin/flags, admin/site) rather than
// duplicating any editing UI here.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useSiteConfig } from "@/lib/site-config";
import { SITE_CONFIG_KEYS } from "@/lib/site-config-cache";
import { getSupabaseClient } from "@/lib/supabase/client";
import { summarizeInstrumentHealth, type InstrumentHealthRow } from "@/lib/admin/overview-stats";
import { adminAuthToken, adminGet } from "@/lib/admin/client";
import { Card, Stat } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

interface FlagRow {
  flag: string;
  enabled: boolean;
}

interface ErrorCounts {
  last24h: number;
  last7d: number;
}

interface SiteSettings {
  maxUsers: number | null;
  userCount: number | null;
}

function TileHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Link href={href} className="text-sm text-emerald-600 hover:underline dark:text-emerald-400">
        {linkLabel}
      </Link>
    </div>
  );
}

export default function AdminOverviewPage() {
  const { t } = useI18n();
  const { config, loaded: siteLoaded } = useSiteConfig();

  const [instruments, setInstruments] = useState<InstrumentHealthRow[] | null>(null);
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [errorCounts, setErrorCounts] = useState<ErrorCounts | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("instruments")
      .select("last_price, price_synced_at")
      .then(({ data }) => {
        if (!active) return;
        setInstruments((data ?? []) as InstrumentHealthRow[]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("feature_flags")
      .select("flag, enabled")
      .then(({ data }) => {
        if (!active) return;
        setFlags((data ?? []) as FlagRow[]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    const run = async () => {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [r24, r7] = await Promise.all([
        supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", since7d),
      ]);
      if (!active) return;
      // A denied/errored read (not readable, or Supabase misconfigured)
      // degrades to the 0 state rather than an indefinite skeleton.
      setErrorCounts({ last24h: r24.count ?? 0, last7d: r7.count ?? 0 });
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  // userCount/maxUsers aren't client-readable (app_settings has RLS enabled
  // with no select policy, and auth.admin.listUsers needs the secret key),
  // so this goes through GET /api/admin/site with a bearer token — same
  // fetch idiom as app/admin/site/page.tsx's own `settings` load.
  useEffect(() => {
    let active = true;
    const run = async () => {
      const token = await adminAuthToken();
      if (!token || !active) return;
      try {
        const body = await adminGet<SiteSettings>("/api/admin/site", token);
        if (active) setSiteSettings(body);
      } catch {
        // Leave siteSettings null — the tile keeps showing its skeleton.
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  const health = instruments !== null ? summarizeInstrumentHealth(instruments) : null;
  const disabledFlags = flags !== null ? flags.filter((f) => !f.enabled).length : null;
  const missingSiteKeys = SITE_CONFIG_KEYS.filter((k) => !config[k]).length;
  const siteReady = siteLoaded || Object.keys(config).length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.overview.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.overview.subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <TileHeader
            title={t("admin.overview.instrumentsTitle")}
            href="/admin/prices"
            linkLabel={t("admin.nav.prices")}
          />
          {health === null ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label={t("admin.overview.instrumentsTotal")} value={String(health.total)} />
              <Stat label={t("admin.overview.instrumentsStale")} value={String(health.stale)} />
              <Stat label={t("admin.overview.instrumentsDead")} value={String(health.dead)} />
              <Stat
                label={t("admin.overview.instrumentsSynthetic")}
                value={String(health.synthetic)}
              />
            </div>
          )}
        </Card>

        <Card>
          <TileHeader
            title={t("admin.overview.errorsTitle")}
            href="/admin/errors"
            linkLabel={t("admin.nav.errors")}
          />
          {errorCounts === null ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label={t("admin.overview.errorsLast24h")} value={String(errorCounts.last24h)} />
              <Stat label={t("admin.overview.errorsLast7d")} value={String(errorCounts.last7d)} />
            </div>
          )}
        </Card>

        <Card>
          <TileHeader
            title={t("admin.overview.flagsTitle")}
            href="/admin/flags"
            linkLabel={t("admin.nav.flags")}
          />
          {disabledFlags === null ? (
            <div className="mt-3">
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-3">
              <Stat label={t("admin.overview.flagsDisabled")} value={String(disabledFlags)} />
            </div>
          )}
        </Card>

        <Card>
          <TileHeader
            title={t("admin.overview.siteTitle")}
            href="/admin/site"
            linkLabel={t("admin.nav.site")}
          />
          {!siteReady ? (
            <div className="mt-3">
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-3">
              <Stat
                label={t("admin.overview.siteStatus")}
                value={
                  missingSiteKeys === 0
                    ? t("admin.overview.siteComplete")
                    : t("admin.overview.siteIncomplete", {
                        count: String(missingSiteKeys),
                        total: String(SITE_CONFIG_KEYS.length),
                      })
                }
                valueClassName={
                  missingSiteKeys === 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }
              />
            </div>
          )}
        </Card>

        <Card>
          <TileHeader
            title={t("admin.overview.usersTitle")}
            href="/admin/site"
            linkLabel={t("admin.nav.site")}
          />
          {siteSettings?.userCount == null ? (
            <div className="mt-3">
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="mt-3">
              <Stat
                label={t("admin.overview.usersRegistered")}
                value={String(siteSettings.userCount)}
                sub={
                  siteSettings.maxUsers != null
                    ? t("admin.overview.usersOfMax", { max: String(siteSettings.maxUsers) })
                    : undefined
                }
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
