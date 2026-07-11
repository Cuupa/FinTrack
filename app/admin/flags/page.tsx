"use client";

// Feature-flags editor: global defaults (`feature_flags`, world-readable,
// listed straight from the browser client) and per-user overrides
// (`user_feature_flags`). The overrides list is NOT read directly: its RLS
// policy only exposes a user's own rows, so an admin browsing every user's
// overrides goes through GET /api/admin/flags (requireAdmin + secret
// client). All writes go through POST /api/admin/flags, never a direct
// client write, per the app's admin-mutation convention.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface FlagRow {
  flag: string;
  enabled: boolean;
  description: string | null;
}

interface OverrideRow {
  user_id: string;
  flag: string;
  enabled: boolean;
}

async function authToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postFlags(body: unknown, token: string): Promise<void> {
  const res = await fetch("/api/admin/flags", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("request failed");
}

export default function AdminFlagsPage() {
  const { t } = useI18n();
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[] | null>(null);
  // Bumped after a successful mutation to re-trigger the load effects below
  // (rather than calling an extracted load function directly inside an
  // effect, which Next 16's react-hooks/set-state-in-effect lint rule
  // flags; see lib/flags/flags-context.tsx and lib/history/use-dividends.ts
  // for the same effect-owns-its-fetch pattern).
  const [flagsVersion, setFlagsVersion] = useState(0);
  const [overridesVersion, setOverridesVersion] = useState(0);
  const [savingFlag, setSavingFlag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newUserId, setNewUserId] = useState("");
  const [newFlag, setNewFlag] = useState("");
  const [newEnabled, setNewEnabled] = useState(true);
  const [addingOverride, setAddingOverride] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OverrideRow | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("feature_flags")
      .select("flag, enabled, description")
      .order("flag")
      .then(({ data }) => {
        if (!active) return;
        setFlags((data ?? []) as FlagRow[]);
      });
    return () => {
      active = false;
    };
  }, [flagsVersion]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const token = await authToken();
      if (!token || !active) return;
      const res = await fetch("/api/admin/flags", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok || !active) return;
      const body = (await res.json()) as { overrides: OverrideRow[] };
      if (active) setOverrides(body.overrides);
    };
    void run();
    return () => {
      active = false;
    };
  }, [overridesVersion]);

  // Default the "add override" flag select to the first loaded flag without
  // syncing it into state via an effect.
  const selectedFlag = newFlag || flags?.[0]?.flag || "";

  const toggleGlobal = async (flag: string, enabled: boolean) => {
    setSavingFlag(flag);
    setError(null);
    try {
      const token = await authToken();
      if (!token) throw new Error();
      await postFlags({ kind: "global", flag, enabled }, token);
      setFlagsVersion((v) => v + 1);
    } catch {
      setError(t("admin.flags.error"));
    } finally {
      setSavingFlag(null);
    }
  };

  const addOverride = async () => {
    if (!newUserId.trim() || !selectedFlag) return;
    setAddingOverride(true);
    setError(null);
    try {
      const token = await authToken();
      if (!token) throw new Error();
      await postFlags(
        { kind: "override", userId: newUserId.trim(), flag: selectedFlag, enabled: newEnabled },
        token,
      );
      setNewUserId("");
      setOverridesVersion((v) => v + 1);
    } catch {
      setError(t("admin.flags.error"));
    } finally {
      setAddingOverride(false);
    }
  };

  const removeOverride = async (row: OverrideRow) => {
    setError(null);
    try {
      const token = await authToken();
      if (!token) throw new Error();
      await postFlags({ kind: "removeOverride", userId: row.user_id, flag: row.flag }, token);
      setOverridesVersion((v) => v + 1);
    } catch {
      setError(t("admin.flags.error"));
    } finally {
      setRemoveTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.flags.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.flags.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.flags.globalTitle")}</h2>
        {flags === null ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-4">{t("admin.flags.colName")}</th>
                  <th className="py-2 pr-4">{t("admin.flags.colDescription")}</th>
                  <th className="py-2">{t("admin.flags.colEnabled")}</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.flag} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-mono text-xs">{f.flag}</td>
                    <td className="py-2 pr-4 text-zinc-500">{f.description}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={f.enabled}
                        aria-label={f.flag}
                        disabled={savingFlag === f.flag}
                        onClick={() => toggleGlobal(f.flag, !f.enabled)}
                        className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          f.enabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-white transition-transform ${
                            f.enabled ? "translate-x-5" : ""
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.flags.overridesTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.flags.overridesSubtitle")}</p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs text-zinc-500">{t("admin.flags.userId")}</label>
            <input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              placeholder={t("admin.flags.userIdPlaceholder")}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">{t("admin.flags.colName")}</label>
            <select
              value={selectedFlag}
              onChange={(e) => setNewFlag(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              {(flags ?? []).map((f) => (
                <option key={f.flag} value={f.flag}>
                  {f.flag}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500">{t("admin.flags.colEnabled")}</label>
            <select
              value={newEnabled ? "1" : "0"}
              onChange={(e) => setNewEnabled(e.target.value === "1")}
              className="mt-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              <option value="1">{t("admin.flags.enabled")}</option>
              <option value="0">{t("admin.flags.disabled")}</option>
            </select>
          </div>
          <Button
            variant="primary"
            onClick={addOverride}
            disabled={addingOverride || !newUserId.trim() || !selectedFlag}
          >
            {t("admin.flags.addOverride")}
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          {overrides === null ? (
            <Skeleton className="h-9 w-full" />
          ) : overrides.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("admin.flags.noOverrides")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-4">{t("admin.flags.userId")}</th>
                  <th className="py-2 pr-4">{t("admin.flags.colName")}</th>
                  <th className="py-2 pr-4">{t("admin.flags.colEnabled")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr
                    key={`${o.user_id}:${o.flag}`}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-4 font-mono text-xs">{o.user_id}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{o.flag}</td>
                    <td className="py-2 pr-4">
                      {o.enabled ? t("admin.flags.enabled") : t("admin.flags.disabled")}
                    </td>
                    <td className="py-2">
                      <Button variant="danger" size="sm" onClick={() => setRemoveTarget(o)}>
                        {t("admin.flags.remove")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("admin.flags.removeConfirmTitle")}
        message={
          removeTarget ? t("admin.flags.removeConfirmMsg", { flag: removeTarget.flag }) : undefined
        }
        confirmLabel={t("admin.flags.remove")}
        onConfirm={() => removeTarget && removeOverride(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
