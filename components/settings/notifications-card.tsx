"use client";

// Settings card for web push reminders (COMPETITION.md F5), registered users
// only and gated behind the `pushNotifications` flag. Opt in per event type
// (dividend pay-day, savings-plan due). Subscription lives on this device;
// prefs are per subscription. Strictly reminders, never marketing.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";
import {
  enablePush,
  disablePush,
  isPushEnabled,
  pushSupported,
  type PushActionResult,
} from "@/lib/push/client";

export function NotificationsCard() {
  const { mode } = useAuth();
  const enabled = useFeatureFlag("pushNotifications");
  if (mode !== "registered" || !enabled) return null;
  return <NotificationsCardContent />;
}

function NotificationsCardContent() {
  const { t } = useI18n();
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [notifyDividends, setNotifyDividends] = useState(true);
  const [notifySavings, setNotifySavings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!pushSupported()) {
        if (active) setSupported(false);
        return;
      }
      const on = await isPushEnabled();
      if (active) setSubscribed(on);
    };
    void check();
    return () => {
      active = false;
    };
  }, []);

  const messageFor = (r: PushActionResult): string | null => {
    if (r === "blocked") return t("notif.blocked");
    if (r === "unsupported") return t("notif.unsupported");
    if (r === "error") return t("notif.saveError");
    return null;
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    const r = await enablePush({ notifyDividends, notifySavings });
    if (r === "ok") setSubscribed(true);
    else setError(messageFor(r));
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    const ok = await disablePush();
    if (ok) setSubscribed(false);
    else setError(t("notif.saveError"));
    setBusy(false);
  };

  // When subscribed, flipping a preference re-subscribes in place (no re-prompt)
  // to persist the new prefs.
  const setPref = async (which: "dividends" | "savings", value: boolean) => {
    const nextDiv = which === "dividends" ? value : notifyDividends;
    const nextSav = which === "savings" ? value : notifySavings;
    setNotifyDividends(nextDiv);
    setNotifySavings(nextSav);
    if (!subscribed) return;
    setBusy(true);
    setError(null);
    const r = await enablePush({ notifyDividends: nextDiv, notifySavings: nextSav });
    if (r !== "ok") setError(messageFor(r));
    setBusy(false);
  };

  return (
    <Card>
      <h2 className="text-base font-semibold">{t("notif.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("notif.subtitle")}</p>

      {!supported ? (
        <p className="mt-4 text-sm text-zinc-500">{t("notif.unsupported")}</p>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={notifyDividends}
                disabled={busy}
                onChange={(e) => void setPref("dividends", e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              {t("notif.dividendLabel")}
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={notifySavings}
                disabled={busy}
                onChange={(e) => void setPref("savings", e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              {t("notif.savingsLabel")}
            </label>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {subscribed ? (
              <>
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                  {t("notif.enabled")}
                </span>
                <Button variant="ghost" onClick={() => void disable()} disabled={busy}>
                  {t("notif.disable")}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void enable()}
                disabled={busy || (!notifyDividends && !notifySavings)}
              >
                {t("notif.enable")}
              </Button>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </>
      )}
    </Card>
  );
}
