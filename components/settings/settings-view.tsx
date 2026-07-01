"use client";

// Account settings: display name, base currency, and password change
// (registered users). Language lives in the header switcher, not here. Guests
// can still set name/currency — they persist to local storage via the store.

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK"];

export function SettingsView() {
  const { data, updateProfile } = usePortfolio();
  const { mode, updatePassword } = useAuth();
  const { t } = useI18n();

  const [name, setName] = useState(data.profile.name ?? "");
  const [currency, setCurrency] = useState(data.profile.currency);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async () => {
    setSavingProfile(true);
    await updateProfile({ name: name.trim() || null, currency });
    setSavingProfile(false);
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2000);
  };

  const savePassword = async () => {
    if (password.length < 6) {
      setPwStatus("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setPwStatus("Passwords do not match.");
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
      setPwStatus(e instanceof Error ? e.message : "Could not update password.");
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwStatus(null), 4000);
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
              placeholder="e.g. Simon"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </Field>

          <Field label={t("settings.currency")}>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
                minLength={6}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </Field>
            <Field label={t("settings.confirmPassword")}>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
