"use client";

// Account settings: display name, base currency, language, and password
// change (registered users). Guests can still set name/currency/language,
// they persist to local storage via the store.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useLlmConfig, type LlmConfigScope } from "@/lib/llm/llm-context";
import { providerList, getProvider } from "@/lib/llm";
import { isLlmErrorCode, llmErrorMessageKey } from "@/lib/llm/error-messages";
import type { LlmProviderId } from "@/lib/llm/types";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isStorageFullError } from "@/lib/store/errors";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import type { Portfolio } from "@/lib/types";
import type { PortfolioPatch } from "@/lib/store/types";
import type { MessageKey } from "@/lib/i18n/dictionaries";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK"];
const CHURCH_TAX_RATES = [0, 0.08, 0.09];

const feeInputCls =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

// Only a NEW password (this change-password form) is floored at this length;
// existing accounts can still sign in with a shorter one.
const NEW_PASSWORD_MIN_LENGTH = 8;

const TABS = ["general", "fees", "ai"] as const;
type TabKey = (typeof TABS)[number];

const TAB_LABEL_KEYS: Record<TabKey, MessageKey> = {
  general: "settings.tabGeneral",
  fees: "settings.tabFees",
  ai: "settings.tabAi",
};

export function SettingsView() {
  const { data, updateProfile, portfolios, updatePortfolio } = usePortfolio();
  const { user, mode, updatePassword, signOut } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const aiEnabled = useFeatureFlag("llmChat");

  const visibleTabs: TabKey[] = aiEnabled ? [...TABS] : TABS.filter((key) => key !== "ai");

  const [tab, setTab] = useState<TabKey>("general");
  // Falls back to "general" if the "ai" tab was selected and then the flag
  // turned off underneath it (per-user override changing live), rather than
  // rendering a tablist with no matching panel.
  const activeTab = visibleTabs.includes(tab) ? tab : "general";

  const [name, setName] = useState(data.profile.name ?? "");
  const [currency, setCurrency] = useState(data.profile.currency);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [taxAllowance, setTaxAllowance] = useState(String(data.profile.taxAllowance));
  const [churchTaxRate, setChurchTaxRate] = useState(data.profile.churchTaxRate);
  const [teilfreistellung, setTeilfreistellung] = useState(data.profile.taxTeilfreistellung);
  const [savedTax, setSavedTax] = useState(false);
  const [savingTax, setSavingTax] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [startingTour, setStartingTour] = useState(false);
  const [tourError, setTourError] = useState<string | null>(null);

  // Broker & fees card: one broker at a time. Derive the fallback (first
  // portfolio) instead of syncing via effect.
  const [selectedFeePortfolioId, setSelectedFeePortfolioId] = useState("");
  const feePortfolioId = portfolios.some((p) => p.id === selectedFeePortfolioId)
    ? selectedFeePortfolioId
    : (portfolios[0]?.id ?? "");
  const feePortfolio = portfolios.find((p) => p.id === feePortfolioId) ?? null;
  const setFeePortfolioId = setSelectedFeePortfolioId;

  const hasPassword = user?.identities?.some((i) => i.provider === "email") ?? false;

  const saveProfile = async () => {
    setSavingProfile(true);
    await updateProfile({ name: name.trim() || null, currency });
    setSavingProfile(false);
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2000);
  };

  const saveTaxSettings = async () => {
    setSavingTax(true);
    const allowance = Number(taxAllowance);
    await updateProfile({
      taxAllowance: Number.isFinite(allowance) ? allowance : data.profile.taxAllowance,
      churchTaxRate,
      taxTeilfreistellung: teilfreistellung,
    });
    setSavingTax(false);
    setSavedTax(true);
    setTimeout(() => setSavedTax(false), 2000);
  };

  const savePassword = async () => {
    if (password.length < NEW_PASSWORD_MIN_LENGTH) {
      setPwStatus(t("settings.passwordTooShort", { n: NEW_PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setPwStatus(t("settings.passwordMismatch"));
      return;
    }
    setSavingPw(true);
    setPwStatus(null);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirmPassword("");
      setPwStatus(t("settings.saved"));
    } catch (e) {
      setPwStatus(e instanceof Error ? e.message : t("settings.passwordUpdateFailed"));
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwStatus(null), 4000);
    }
  };

  const startTour = async () => {
    setStartingTour(true);
    setTourError(null);
    try {
      await updateProfile({ tourDoneAt: null });
      router.push("/");
    } catch (err) {
      setTourError(isStorageFullError(err) ? t("common.storageFull") : t("settings.tour.error"));
    } finally {
      setStartingTour(false);
    }
  };

  const deleteAccount = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t("settings.deleteAccountError"));
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: deletePassword }),
      });
      if (!res.ok) {
        if (res.status === 403) throw new Error(t("settings.deleteAccountWrongPassword"));
        throw new Error(t("settings.deleteAccountError"));
      }
      await signOut();
      router.push("/");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("settings.deleteAccountError"));
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div role="tablist" className="-mb-px flex gap-6">
          {visibleTabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setTab(key)}
              className={`border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                activeTab === key
                  ? "border-emerald-500 text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t(TAB_LABEL_KEYS[key])}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "general" && (
        <Card>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            <section className="py-5 first:pt-0 last:pb-0">
              <h2 className="text-base font-semibold">{t("settings.title")}</h2>
              <div className="mt-4 space-y-4">
                <Field label={t("settings.name")}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("settings.namePlaceholder")}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                  />
                </Field>

                <Field label={t("settings.currency")}>
                  <SelectMenu
                    value={currency}
                    onChange={setCurrency}
                    ariaLabel={t("settings.currency")}
                    options={[...new Set([currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))}
                  />
                </Field>

                <div className="flex items-center gap-3">
                  <Button variant="primary" onClick={saveProfile} disabled={savingProfile}>
                    {savingProfile ? "…" : t("settings.save")}
                  </Button>
                  {savedProfile && (
                    <span className="text-sm text-emerald-600 dark:text-emerald-400">
                      {t("settings.saved")}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="py-5 first:pt-0 last:pb-0">
              <h2 className="text-base font-semibold">{t("settings.language")}</h2>
              <div className="mt-4">
                <LocaleSwitcher />
              </div>
            </section>

            <section className="py-5 first:pt-0 last:pb-0">
              <h2 className="text-base font-semibold">{t("settings.tour.title")}</h2>
              <div className="mt-4 space-y-3">
                <p className="text-sm text-zinc-500">{t("settings.tour.body")}</p>
                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={startTour} disabled={startingTour}>
                    {startingTour ? "…" : t("settings.tour.button")}
                  </Button>
                  {tourError && (
                    <span className="text-sm text-red-600 dark:text-red-400">{tourError}</span>
                  )}
                </div>
              </div>
            </section>

            {mode === "registered" && (
              <section className="py-5 first:pt-0 last:pb-0">
                <h2 className="text-base font-semibold">{t("settings.changePassword")}</h2>
                <div className="mt-4 space-y-4">
                  <Field label={t("settings.newPassword")}>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      minLength={NEW_PASSWORD_MIN_LENGTH}
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  </Field>
                  <Field label={t("settings.confirmPassword")}>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      minLength={NEW_PASSWORD_MIN_LENGTH}
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="primary"
                      onClick={savePassword}
                      disabled={savingPw || !password || !confirmPassword}
                    >
                      {savingPw ? "…" : t("settings.save")}
                    </Button>
                    {pwStatus && <span className="text-sm text-zinc-500">{pwStatus}</span>}
                  </div>
                </div>
              </section>
            )}

            {mode === "registered" && (
              <section className="py-5 first:pt-0 last:pb-0">
                <h2 className="text-base font-semibold text-red-600 dark:text-red-400">
                  {t("settings.dangerZone")}
                </h2>
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-zinc-500">{t("settings.deleteAccountHint")}</p>
                  {hasPassword && (
                    <Field label={t("settings.deleteAccountPassword")}>
                      <input
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        autoComplete="current-password"
                        className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-red-500 dark:border-zinc-700"
                      />
                    </Field>
                  )}
                  <Field label={t("settings.deleteAccountType")}>
                    <input
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="delete"
                      autoComplete="off"
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-red-500 dark:border-zinc-700"
                    />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="danger"
                      onClick={deleteAccount}
                      disabled={
                        deleting ||
                        deleteConfirm.trim().toLowerCase() !== "delete" ||
                        (hasPassword && !deletePassword)
                      }
                    >
                      {deleting ? "…" : t("settings.deleteAccount")}
                    </Button>
                    {deleteError && (
                      <span className="text-sm text-red-600 dark:text-red-400">{deleteError}</span>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        </Card>
      )}

      {activeTab === "fees" && (
        <Card>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            <section className="py-5 first:pt-0 last:pb-0">
              <h2 className="text-base font-semibold">{t("settings.taxSection")}</h2>
              <div className="mt-4 space-y-4">
                <Field label={t("settings.taxAllowance")} hint={t("settings.taxAllowanceHint")}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={taxAllowance}
                    onChange={(e) => setTaxAllowance(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                  />
                </Field>

                <Field label={t("settings.churchTax")}>
                  <SelectMenu
                    value={String(churchTaxRate)}
                    onChange={(v) => setChurchTaxRate(Number(v))}
                    ariaLabel={t("settings.churchTax")}
                    options={CHURCH_TAX_RATES.map((r) => ({
                      value: String(r),
                      label: r === 0 ? t("settings.churchTaxNone") : `${Math.round(r * 100)} %`,
                    }))}
                  />
                </Field>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={teilfreistellung}
                    onChange={(e) => setTeilfreistellung(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                  />
                  <span>
                    <span className="block text-sm font-medium">{t("settings.teilfreistellung")}</span>
                    <span className="block text-xs text-zinc-500">{t("settings.teilfreistellungHint")}</span>
                  </span>
                </label>

                <div className="flex items-center gap-3">
                  <Button variant="primary" onClick={saveTaxSettings} disabled={savingTax}>
                    {savingTax ? "…" : t("settings.save")}
                  </Button>
                  {savedTax && (
                    <span className="text-sm text-emerald-600 dark:text-emerald-400">
                      {t("settings.saved")}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="py-5 first:pt-0 last:pb-0">
              <h2 className="text-base font-semibold">{t("settings.fees.title")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{t("settings.fees.hint")}</p>
              <div className="mt-4">
                <Field label={t("settings.fees.broker")}>
                  <SelectMenu
                    value={feePortfolioId}
                    onChange={setFeePortfolioId}
                    ariaLabel={t("settings.fees.broker")}
                    options={portfolios.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
              </div>
              {feePortfolio && (
                <div className="mt-4">
                  <PortfolioFeeRow
                    key={feePortfolio.id}
                    portfolio={feePortfolio}
                    baseCurrency={data.profile.currency}
                    onSave={updatePortfolio}
                  />
                </div>
              )}
            </section>
          </div>
        </Card>
      )}

      {activeTab === "ai" && aiEnabled && (
        <Card>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            <AiAssistantSection />
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * One portfolio's fee-model row inside the "Broker & fees" card. Local state
 * is seeded once from `portfolio` at mount (same pattern as the top-level
 * profile/tax fields above) rather than kept in sync via effect, so an
 * in-flight edit here survives an unrelated portfolio list refresh.
 */
function PortfolioFeeRow({
  portfolio,
  baseCurrency,
  onSave,
}: {
  portfolio: Portfolio;
  baseCurrency: string;
  onSave: (id: string, patch: PortfolioPatch) => Promise<void>;
}) {
  const { t } = useI18n();
  const [flat, setFlat] = useState(String(portfolio.feeOrderFlat ?? 0));
  const [freeFrom, setFreeFrom] = useState(
    portfolio.feeOrderFreeFrom != null ? String(portfolio.feeOrderFreeFrom) : "",
  );
  const [savingsPlan, setSavingsPlan] = useState(String(portfolio.feeSavingsPlan ?? 0));
  const [taxAllowance, setTaxAllowance] = useState(
    portfolio.taxAllowance != null ? String(portfolio.taxAllowance) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const flatNum = parseDecimal(flat);
      const freeFromNum = freeFrom.trim() ? parseDecimal(freeFrom) : null;
      const savingsPlanNum = parseDecimal(savingsPlan);
      const taxAllowanceNum = taxAllowance.trim() ? parseDecimal(taxAllowance) : null;
      await onSave(portfolio.id, {
        feeOrderFlat: Number.isFinite(flatNum) ? flatNum : 0,
        feeOrderFreeFrom:
          freeFromNum != null && Number.isFinite(freeFromNum) ? freeFromNum : null,
        feeSavingsPlan: Number.isFinite(savingsPlanNum) ? savingsPlanNum : 0,
        taxAllowance:
          taxAllowanceNum != null && Number.isFinite(taxAllowanceNum) ? taxAllowanceNum : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("settings.fees.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("settings.fees.orderFlat")}>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={flat}
              onChange={(e) => setFlat(stripLeadingZero(e.target.value))}
              className={`${feeInputCls} pr-12`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              {baseCurrency}
            </span>
          </div>
        </Field>
        <Field label={t("settings.fees.orderFreeFrom")} hint={t("settings.fees.orderFreeFromHint")}>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="—"
              value={freeFrom}
              onChange={(e) => setFreeFrom(stripLeadingZero(e.target.value))}
              className={`${feeInputCls} pr-12`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              {baseCurrency}
            </span>
          </div>
        </Field>
        <Field label={t("settings.fees.savingsPlan")}>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={savingsPlan}
              onChange={(e) => setSavingsPlan(stripLeadingZero(e.target.value))}
              className={`${feeInputCls} pr-12`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              {baseCurrency}
            </span>
          </div>
        </Field>
        <Field
          label={t("settings.fees.taxAllowance")}
          hint={t("settings.fees.taxAllowanceHint")}
        >
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="—"
              value={taxAllowance}
              onChange={(e) => setTaxAllowance(stripLeadingZero(e.target.value))}
              className={`${feeInputCls} pr-12`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              {baseCurrency}
            </span>
          </div>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "…" : t("settings.save")}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("settings.saved")}
          </span>
        )}
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}

/**
 * "AI assistant" settings tab (flag `llmChat`): provider/model/key form,
 * a storage-location control (registered users only), "Test connection"
 * ping, and "Remove key". Local state is seeded once from the stored config
 * at mount (same pattern as the profile/tax fields and PortfolioFeeRow
 * above) rather than kept in sync via effect. The key rides `useLlmConfig`
 * (Guest Mode: always the store seam's browser blob, no choice; registered:
 * either the account's `llm_settings` row or the browser-local `fintrack-llm`
 * key, per the scope control below) except for Test connection, a one-shot
 * ping POSTed to /api/llm with the CURRENT form values, which may differ from
 * the last saved config and is never persisted either way.
 */
function AiAssistantSection() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { config, scope: activeScope, setConfig, clearConfig } = useLlmConfig();

  const [provider, setProvider] = useState<LlmProviderId>(config?.provider ?? providerList[0].id);
  const [model, setModel] = useState(config?.model ?? providerList[0].defaultModel);
  const [key, setKey] = useState(config?.key ?? "");
  const [showKey, setShowKey] = useState(false);
  // Registered users only; guests never render the control and always save
  // through the store seam regardless of this value. Seeded from the active
  // scope so an existing config's location is reflected, "account" by
  // default when nothing is configured yet.
  const [scope, setScope] = useState<LlmConfigScope>(activeScope);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  const selectedProvider = getProvider(provider) ?? providerList[0];

  function handleProviderChange(next: string) {
    const p = getProvider(next);
    if (!p) return;
    setProvider(p.id);
    setModel(p.defaultModel);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setConfig({ provider, model, key: key.trim() }, user ? scope : undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("settings.ai.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ping: true, provider, model, key: key.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (res.ok && data?.ok) {
        setTestResult({ ok: true, message: t("settings.ai.testSuccess") });
        return;
      }
      const messageKey = isLlmErrorCode(data?.error)
        ? llmErrorMessageKey(data.error)
        : res.status === 429
          ? "settings.ai.error.rateLimited"
          : "settings.ai.error.network";
      setTestResult({ ok: false, message: t(messageKey) });
    } catch {
      setTestResult({ ok: false, message: t("settings.ai.error.network") });
    } finally {
      setTesting(false);
    }
  }

  async function removeKey() {
    setError(null);
    try {
      await clearConfig();
      setKey("");
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("settings.ai.saveError"));
    } finally {
      setRemoveConfirmOpen(false);
    }
  }

  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <h2 className="text-base font-semibold">{t("settings.ai.title")}</h2>
      <div className="mt-4 space-y-4">
        <Field label={t("settings.ai.provider")}>
          <SelectMenu
            value={provider}
            onChange={handleProviderChange}
            ariaLabel={t("settings.ai.provider")}
            options={providerList.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Field>

        <Field label={t("settings.ai.model")}>
          <SelectMenu
            value={model}
            onChange={setModel}
            ariaLabel={t("settings.ai.model")}
            options={selectedProvider.models.map((m) => ({ value: m.id, label: m.label }))}
          />
        </Field>

        <Field label={t("settings.ai.apiKey")}>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              placeholder={t("settings.ai.apiKeyPlaceholder")}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 pr-16 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute inset-y-0 right-2 flex items-center px-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {showKey ? t("settings.ai.hideKey") : t("settings.ai.showKey")}
            </button>
          </div>
        </Field>

        {user && (
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              {t("settings.ai.scope.label")}
            </span>
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/50">
              {(["account", "browser"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  aria-pressed={scope === s}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    scope === s
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {t(s === "account" ? "settings.ai.scope.account" : "settings.ai.scope.browser")}
                </button>
              ))}
            </div>
            {scope === "browser" && (
              <p className="mt-1 text-xs text-zinc-500">{t("settings.ai.scope.browserHint")}</p>
            )}
          </div>
        )}

        <p className="text-xs text-zinc-500">
          {t(user ? "settings.ai.privacyNote" : "settings.ai.privacyNoteGuest")}{" "}
          <Link
            href="/datenschutz"
            className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            {t("settings.ai.privacyLink")}
          </Link>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void save()} disabled={saving || !key.trim()}>
            {saving ? "…" : t("settings.save")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void testConnection()}
            disabled={testing || !key.trim()}
          >
            {testing ? "…" : t("settings.ai.testConnection")}
          </Button>
          {config && (
            <Button variant="danger" onClick={() => setRemoveConfirmOpen(true)}>
              {t("settings.ai.removeKey")}
            </Button>
          )}
        </div>

        {saved && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("settings.saved")}</p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {testResult && (
          <p
            className={`text-sm ${
              testResult.ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {testResult.message}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={removeConfirmOpen}
        title={t("settings.ai.removeKeyTitle")}
        message={t("settings.ai.removeKeyMsg")}
        confirmLabel={t("settings.ai.removeKeyConfirm")}
        onConfirm={removeKey}
        onCancel={() => setRemoveConfirmOpen(false)}
      />
    </section>
  );
}
