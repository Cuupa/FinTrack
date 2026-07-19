"use client";

// Billing admin editor (round 2026-07-19b, Task B): Stripe secret key +
// webhook secret (app_settings, never client-readable, GET only returns
// presence booleans) and the billing_config prices/selling toggle
// (world-readable, but writes still go through the admin route like
// everything else in app/admin). Both cards save through POST
// /api/admin/billing (kind "keys" / "config"), same convention as
// app/admin/site/page.tsx.

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { adminAuthToken, adminGet, adminPost } from "@/lib/admin/client";

interface BillingAdminData {
  priceMonthly: string | null;
  priceYearly: string | null;
  enabled: boolean;
  secretKeySet: boolean;
  webhookSecretSet: boolean;
}

type KeyField = "secretKey" | "webhookSecret";

export default function AdminBillingPage() {
  const { t } = useI18n();

  const [data, setData] = useState<BillingAdminData | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Keys card: the inputs are always blank on load (a stored secret is never
  // echoed back), so a non-empty draft always means "the admin just typed
  // this" — an untouched (empty) input is omitted from the save request
  // rather than sent as a clear, per the ledger's redaction rule.
  const [secretKeyDraft, setSecretKeyDraft] = useState("");
  const [webhookSecretDraft, setWebhookSecretDraft] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<KeyField | null>(null);

  // Selling card: per-field draft overrides the loaded value once edited,
  // same "derive the default, don't sync it via effect" technique as
  // app/admin/site/page.tsx's drafts.
  const [priceMonthlyDraft, setPriceMonthlyDraft] = useState<string | null>(null);
  const [priceYearlyDraft, setPriceYearlyDraft] = useState<string | null>(null);
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const token = await adminAuthToken();
      if (!token || !active) return;
      try {
        const body = await adminGet<BillingAdminData>("/api/admin/billing", token);
        if (active) setData(body);
      } catch {
        // Leave data null - both cards keep showing their skeleton.
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [dataVersion]);

  const saveKeys = async () => {
    const body: Partial<Record<KeyField, string>> = {};
    if (secretKeyDraft.trim() !== "") body.secretKey = secretKeyDraft.trim();
    if (webhookSecretDraft.trim() !== "") body.webhookSecret = webhookSecretDraft.trim();
    if (Object.keys(body).length === 0) return;

    setSavingKeys(true);
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost("/api/admin/billing", { kind: "keys", ...body }, token);
      setSecretKeyDraft("");
      setWebhookSecretDraft("");
      setDataVersion((v) => v + 1);
    } catch {
      setError(t("admin.billing.error"));
    } finally {
      setSavingKeys(false);
    }
  };

  const removeKey = async (field: KeyField) => {
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost("/api/admin/billing", { kind: "keys", [field]: null }, token);
      setDataVersion((v) => v + 1);
    } catch {
      setError(t("admin.billing.error"));
    } finally {
      setRemoveTarget(null);
    }
  };

  const priceMonthlyValue = priceMonthlyDraft ?? data?.priceMonthly ?? "";
  const priceYearlyValue = priceYearlyDraft ?? data?.priceYearly ?? "";
  const enabledValue = enabledDraft ?? data?.enabled ?? false;

  const saveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminPost(
        "/api/admin/billing",
        {
          kind: "config",
          priceMonthly: priceMonthlyValue.trim() === "" ? null : priceMonthlyValue.trim(),
          priceYearly: priceYearlyValue.trim() === "" ? null : priceYearlyValue.trim(),
          enabled: enabledValue,
        },
        token,
      );
      setDataVersion((v) => v + 1);
    } catch {
      setError(t("admin.billing.error"));
    } finally {
      setSavingConfig(false);
    }
  };

  const initialLoad = data === null && dataVersion === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.billing.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.billing.subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.billing.keysTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.billing.keysSubtitle")}</p>

        {initialLoad ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div>
              <label className="block text-xs text-zinc-500">
                {t("admin.billing.secretKeyLabel")}
              </label>
              <input
                type="password"
                autoComplete="off"
                value={secretKeyDraft}
                onChange={(e) => setSecretKeyDraft(e.target.value)}
                placeholder={t("admin.billing.secretKeyPlaceholder")}
                className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <div className="mt-1.5 flex items-center gap-3">
                <p className="text-xs text-zinc-500">
                  {data?.secretKeySet
                    ? t("admin.billing.statusSet")
                    : t("admin.billing.statusNotSet")}
                </p>
                {data?.secretKeySet && (
                  <button
                    type="button"
                    onClick={() => setRemoveTarget("secretKey")}
                    className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
                  >
                    {t("admin.billing.removeKey")}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-500">
                {t("admin.billing.webhookSecretLabel")}
              </label>
              <input
                type="password"
                autoComplete="off"
                value={webhookSecretDraft}
                onChange={(e) => setWebhookSecretDraft(e.target.value)}
                placeholder={t("admin.billing.webhookSecretPlaceholder")}
                className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
              <div className="mt-1.5 flex items-center gap-3">
                <p className="text-xs text-zinc-500">
                  {data?.webhookSecretSet
                    ? t("admin.billing.statusSet")
                    : t("admin.billing.statusNotSet")}
                </p>
                {data?.webhookSecretSet && (
                  <button
                    type="button"
                    onClick={() => setRemoveTarget("webhookSecret")}
                    className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
                  >
                    {t("admin.billing.removeKey")}
                  </button>
                )}
              </div>
            </div>

            <Button
              variant="secondary"
              onClick={saveKeys}
              disabled={
                savingKeys || (secretKeyDraft.trim() === "" && webhookSecretDraft.trim() === "")
              }
            >
              {t("admin.billing.save")}
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.billing.sellingTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.billing.sellingSubtitle")}</p>

        {initialLoad ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-6 w-32" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="min-w-[220px] max-w-md">
              <label className="block text-xs text-zinc-500">
                {t("admin.billing.priceMonthlyLabel")}
              </label>
              <input
                value={priceMonthlyValue}
                onChange={(e) => setPriceMonthlyDraft(e.target.value)}
                placeholder={t("admin.billing.priceIdPlaceholder")}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>

            <div className="min-w-[220px] max-w-md">
              <label className="block text-xs text-zinc-500">
                {t("admin.billing.priceYearlyLabel")}
              </label>
              <input
                value={priceYearlyValue}
                onChange={(e) => setPriceYearlyDraft(e.target.value)}
                placeholder={t("admin.billing.priceIdPlaceholder")}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={enabledValue}
                aria-label={t("admin.billing.enabledLabel")}
                onClick={() => setEnabledDraft(!enabledValue)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  enabledValue ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-white transition-transform ${
                    enabledValue ? "translate-x-5" : ""
                  }`}
                />
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                {t("admin.billing.enabledLabel")}
              </span>
            </div>

            <div>
              <Button variant="secondary" onClick={saveConfig} disabled={savingConfig}>
                {t("admin.billing.save")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("admin.billing.removeConfirmTitle")}
        message={
          removeTarget
            ? t("admin.billing.removeConfirmMsg", {
                field:
                  removeTarget === "secretKey"
                    ? t("admin.billing.secretKeyLabel")
                    : t("admin.billing.webhookSecretLabel"),
              })
            : undefined
        }
        confirmLabel={t("admin.billing.removeKey")}
        onConfirm={() => removeTarget && removeKey(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
