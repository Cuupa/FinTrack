"use client";

// Billing admin editor (round 2026-07-19b, Task B): Stripe secret key +
// webhook secret (app_settings, never client-readable, GET only returns
// presence booleans) and the billing_config prices/selling toggle
// (world-readable, but writes still go through the admin route like
// everything else in app/admin). The "Selling" card also carries the two
// owner-typed display price strings (migration 0070, e.g. "4,99 EUR")
// rendered on /pricing -- free text, never formatted or computed with,
// separate from the Stripe price ids above them. Both cards save through
// POST /api/admin/billing (kind "keys" / "config"), same convention as
// app/admin/site/page.tsx.
//
// The "Premium grants" card (migration 0068 "gratitude premium") is a third,
// independent card backed by /api/admin/billing/grants: grant a user Pro
// without a Stripe subscription, with an optional expiry, and revoke a
// grant. The user-lookup (email search -> id) and sortable-table patterns
// mirror app/admin/flags/page.tsx's per-user override editor exactly.

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";
import { formatInstant } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { adminAuthToken, adminDelete, adminGet, adminPost } from "@/lib/admin/client";

interface BillingAdminData {
  priceMonthly: string | null;
  priceYearly: string | null;
  priceMonthlyDisplay: string | null;
  priceYearlyDisplay: string | null;
  enabled: boolean;
  secretKeySet: boolean;
  webhookSecretSet: boolean;
}

type KeyField = "secretKey" | "webhookSecret";

interface GrantRow {
  id: string;
  userId: string;
  email: string | null;
  plan: string;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface UserResult {
  id: string;
  email: string | null;
}

type GrantSortKey = "email" | "expiresAt" | "note" | "createdAt";

function grantCompare(a: GrantRow, b: GrantRow, key: GrantSortKey): number {
  switch (key) {
    case "email":
      return (a.email ?? a.userId).localeCompare(b.email ?? b.userId);
    case "expiresAt": {
      // Infinite (null) sorts after every dated expiry, ascending.
      const av = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const bv = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      return av - bv;
    }
    case "note":
      return (a.note ?? "").localeCompare(b.note ?? "");
    case "createdAt":
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }
}

// Sortable column header: same toggle-direction idiom as SortTh in
// app/admin/flags/page.tsx (click to sort ascending, click again to flip
// direction, ▲/▼ indicator next to the active column).
function GrantTh({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: GrantSortKey;
  sort: { key: GrantSortKey; dir: 1 | -1 };
  onSort: (k: GrantSortKey) => void;
}) {
  return (
    <th className="py-2 pr-4 text-left">
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        <span className="text-[10px]">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

async function searchUsers(q: string, token: string): Promise<UserResult[]> {
  const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("request failed");
  const body = (await res.json()) as { users: UserResult[] };
  return body.users;
}

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
  const [priceMonthlyDisplayDraft, setPriceMonthlyDisplayDraft] = useState<string | null>(null);
  const [priceYearlyDisplayDraft, setPriceYearlyDisplayDraft] = useState<string | null>(null);
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Grants card: list + sort state, mirroring app/admin/flags/page.tsx's
  // overrides table.
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const [grantsVersion, setGrantsVersion] = useState(0);
  const [grantSort, setGrantSort] = useState<{ key: GrantSortKey; dir: 1 | -1 }>({
    key: "createdAt",
    dir: -1,
  });
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Grants card: the add form. A user must be picked via the email search
  // (chosenUser) before granting — same reasoning as app/admin/flags/page.tsx's
  // email lookup, but without a raw-id fallback input since /api/admin/users
  // is the only source of a user id on this page.
  const [emailQuery, setEmailQuery] = useState("");
  const [emailResults, setEmailResults] = useState<UserResult[] | null>(null);
  const [emailResultsQuery, setEmailResultsQuery] = useState<string | null>(null);
  const [chosenUser, setChosenUser] = useState<UserResult | null>(null);
  const [expiresAtDraft, setExpiresAtDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [granting, setGranting] = useState(false);

  const trimmedEmailQuery = emailQuery.trim();
  const searchingEmail = trimmedEmailQuery.length >= 2 && emailResultsQuery !== trimmedEmailQuery;

  useEffect(() => {
    const q = emailQuery.trim();
    if (q.length < 2) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const token = await adminAuthToken();
        if (!token || !active) return;
        const users = await searchUsers(q, token);
        if (active) {
          setEmailResults(users);
          setEmailResultsQuery(q);
        }
      } catch {
        if (active) {
          setEmailResults([]);
          setEmailResultsQuery(q);
          setError(t("admin.billing.error"));
        }
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [emailQuery, t]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const token = await adminAuthToken();
      if (!token || !active) return;
      try {
        const body = await adminGet<{ grants: GrantRow[] }>("/api/admin/billing/grants", token);
        if (active) setGrants(body.grants);
      } catch {
        // Leave grants null - the card keeps showing its skeleton.
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [grantsVersion]);

  const sortedGrants = useMemo(
    () => (grants ?? []).slice().sort((a, b) => grantCompare(a, b, grantSort.key) * grantSort.dir),
    [grants, grantSort],
  );

  function toggleGrantSort(key: GrantSortKey) {
    setGrantSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  const grantUser = async () => {
    if (!chosenUser) return;
    setGranting(true);
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      // A plain `type="date"` value is a floating day; interpret it as the
      // END of that day (23:59:59.999) so a grant expiring "today" still
      // covers today, rather than parsing to midnight UTC and reading as
      // already-past by the time the request lands (past-date rejection is
      // otherwise the API's own guard, in lib/server/billing-admin.ts).
      const expiresAt =
        expiresAtDraft.trim() === "" ? null : `${expiresAtDraft.trim()}T23:59:59.999Z`;
      await adminPost(
        "/api/admin/billing/grants",
        { userId: chosenUser.id, expiresAt, note: noteDraft.trim() === "" ? null : noteDraft.trim() },
        token,
      );
      setChosenUser(null);
      setEmailQuery("");
      setEmailResults(null);
      setEmailResultsQuery(null);
      setExpiresAtDraft("");
      setNoteDraft("");
      setGrantsVersion((v) => v + 1);
    } catch {
      setError(t("admin.billing.error"));
    } finally {
      setGranting(false);
    }
  };

  const revokeGrant = async (row: GrantRow) => {
    setRevoking(true);
    setError(null);
    try {
      const token = await adminAuthToken();
      if (!token) throw new Error();
      await adminDelete("/api/admin/billing/grants", { id: row.id }, token);
      setGrantsVersion((v) => v + 1);
    } catch {
      setError(t("admin.billing.error"));
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  };

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
  const priceMonthlyDisplayValue = priceMonthlyDisplayDraft ?? data?.priceMonthlyDisplay ?? "";
  const priceYearlyDisplayValue = priceYearlyDisplayDraft ?? data?.priceYearlyDisplay ?? "";
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
          priceMonthlyDisplay:
            priceMonthlyDisplayValue.trim() === "" ? null : priceMonthlyDisplayValue.trim(),
          priceYearlyDisplay:
            priceYearlyDisplayValue.trim() === "" ? null : priceYearlyDisplayValue.trim(),
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

            <div className="min-w-[220px] max-w-md">
              <label className="block text-xs text-zinc-500">
                {t("admin.billing.priceMonthlyDisplayLabel")}
              </label>
              <input
                value={priceMonthlyDisplayValue}
                onChange={(e) => setPriceMonthlyDisplayDraft(e.target.value)}
                placeholder={t("admin.billing.priceDisplayPlaceholder")}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </div>

            <div className="min-w-[220px] max-w-md">
              <label className="block text-xs text-zinc-500">
                {t("admin.billing.priceYearlyDisplayLabel")}
              </label>
              <input
                value={priceYearlyDisplayValue}
                onChange={(e) => setPriceYearlyDisplayDraft(e.target.value)}
                placeholder={t("admin.billing.priceDisplayPlaceholder")}
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

      <Card>
        <h2 className="text-lg font-semibold">{t("admin.billing.grantsTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("admin.billing.grantsSubtitle")}</p>

        <div className="mt-4 min-w-[220px] max-w-sm">
          <label className="block text-xs text-zinc-500">
            {t("admin.billing.grantSearchEmail")}
          </label>
          <input
            value={emailQuery}
            onChange={(e) => {
              setEmailQuery(e.target.value);
              setChosenUser(null);
            }}
            placeholder={t("admin.billing.grantSearchEmailPlaceholder")}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          {searchingEmail && (
            <p className="mt-1 text-xs text-zinc-500">{t("admin.billing.grantSearching")}</p>
          )}
          {!searchingEmail && trimmedEmailQuery.length >= 2 && emailResults !== null && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              {emailResults.length === 0 ? (
                <li className="px-3 py-2 text-xs text-zinc-500">
                  {t("admin.billing.grantSearchNoResults")}
                </li>
              ) : (
                emailResults.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosenUser(u);
                        setEmailQuery("");
                        setEmailResults(null);
                        setEmailResultsQuery(null);
                      }}
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      {u.email ?? u.id}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
          {chosenUser && (
            <p className="mt-1 text-xs text-zinc-500">
              {t("admin.billing.grantChosen", { email: chosenUser.email ?? chosenUser.id })}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-zinc-500">
              {t("admin.billing.grantEndDateLabel")}
            </label>
            <input
              type="date"
              value={expiresAtDraft}
              onChange={(e) => setExpiresAtDraft(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs text-zinc-500">
              {t("admin.billing.grantNoteLabel")}
            </label>
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t("admin.billing.grantNotePlaceholder")}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </div>
          <Button variant="primary" onClick={grantUser} disabled={granting || !chosenUser}>
            {t("admin.billing.grantButton")}
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          {grants === null ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : grants.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("admin.billing.grantsEmpty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                  <GrantTh
                    label={t("admin.billing.grantsColEmail")}
                    k="email"
                    sort={grantSort}
                    onSort={toggleGrantSort}
                  />
                  <GrantTh
                    label={t("admin.billing.grantsColEndDate")}
                    k="expiresAt"
                    sort={grantSort}
                    onSort={toggleGrantSort}
                  />
                  <GrantTh
                    label={t("admin.billing.grantsColNote")}
                    k="note"
                    sort={grantSort}
                    onSort={toggleGrantSort}
                  />
                  <GrantTh
                    label={t("admin.billing.grantsColCreated")}
                    k="createdAt"
                    sort={grantSort}
                    onSort={toggleGrantSort}
                  />
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedGrants.map((g) => (
                  <tr
                    key={g.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                  >
                    <td className="py-2 pr-4">{g.email ?? g.userId}</td>
                    <td className="py-2 pr-4">
                      {g.expiresAt ? formatInstant(g.expiresAt) : t("admin.billing.grantsUnlimited")}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">{g.note}</td>
                    <td className="py-2 pr-4 text-zinc-500">{formatInstant(g.createdAt)}</td>
                    <td className="py-2">
                      <Button variant="danger" size="sm" onClick={() => setRevokeTarget(g)}>
                        {t("admin.billing.revoke")}
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

      <ConfirmDialog
        open={revokeTarget !== null}
        title={t("admin.billing.revokeConfirmTitle")}
        message={
          revokeTarget
            ? t("admin.billing.revokeConfirmMsg", {
                email: revokeTarget.email ?? revokeTarget.userId,
              })
            : undefined
        }
        confirmLabel={t("admin.billing.revoke")}
        onConfirm={() => revokeTarget && !revoking && revokeGrant(revokeTarget)}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
