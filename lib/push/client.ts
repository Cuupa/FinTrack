"use client";

// Client-side web push subscription management (COMPETITION.md F5). Talks to
// /api/push/* with the signed-in user's session bearer token (same pattern as
// the billing checkout helper). Registration uses getRegistration() rather
// than the spec's `ready` promise, which never resolves when no service worker
// is installed (e.g. dev builds, where registration is skipped) and would hang.

import { getSupabaseClient } from "@/lib/supabase/client";

export type PushPrefs = { notifyDividends: boolean; notifySavings: boolean };
export type PushActionResult = "ok" | "blocked" | "unsupported" | "error";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

async function authPost(path: string, body: unknown): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether this device currently has a live push subscription. */
export async function isPushEnabled(): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg) return false;
  return (await reg.pushManager.getSubscription()) != null;
}

/** Subscribe this device (prompting for permission if needed) and store the
 *  subscription + prefs. Reuses an existing subscription so changing prefs
 *  never re-prompts. */
export async function enablePush(prefs: PushPrefs): Promise<PushActionResult> {
  if (!pushSupported()) return "unsupported";
  const reg = await getRegistration();
  if (!reg) return "unsupported";

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return "blocked";

  let publicKey: string | null = null;
  try {
    const res = await fetch("/api/push/vapid");
    publicKey = res.ok ? ((await res.json()) as { publicKey?: string | null }).publicKey ?? null : null;
  } catch {
    publicKey = null;
  }
  if (!publicKey) return "error";

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    } catch {
      return "error";
    }
  }

  const json = sub.toJSON();
  const ok = await authPost("/api/push/subscribe", {
    subscription: { endpoint: sub.endpoint, keys: json.keys },
    notifyDividends: prefs.notifyDividends,
    notifySavings: prefs.notifySavings,
  });
  return ok ? "ok" : "error";
}

/** Remove this device's subscription. */
export async function disablePush(): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg) return true;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  return authPost("/api/push/unsubscribe", { endpoint });
}
