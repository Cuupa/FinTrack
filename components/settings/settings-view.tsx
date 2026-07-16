"use client";

// Account settings: display name, base currency, language, and password
// change (registered users). Guests can still set name/currency/language,
// they persist to local storage via the store.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isStorageFullError } from "@/lib/store/errors";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK"];
const CHURCH_TAX_RATES = [0, 0.08, 0.09];

// Only a NEW password (this change-password form) is floored at this length;
// existing accounts can still sign in with a shorter one.
const NEW_PASSWORD_MIN_LENGTH = 8;

export function SettingsView() {
  const { data, updateProfile } = usePortfolio();
  const { user, mode, updatePassword, signOut } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

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
    <div className="max-w-xl space-y-6">
      <Card>
        <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
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
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("settings.language")}</h2>
        <div className="mt-4">
          <LocaleSwitcher />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("settings.tour.title")}</h2>
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
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("settings.taxSection")}</h2>
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
      </Card>

      {mode === "registered" && (
        <Card>
          <h2 className="text-lg font-semibold">{t("settings.changePassword")}</h2>
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
        </Card>
      )}

      {mode === "registered" && (
        <Card className="border-red-300 dark:border-red-900">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">
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
