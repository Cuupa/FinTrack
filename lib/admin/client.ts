"use client";

// Shared browser-side helpers for admin pages that call `POST /api/admin/*`
// routes: resolve the signed-in session's access token and post a JSON body
// with it as a Bearer token, matching requireAdmin's expectation
// (lib/server/require-admin.ts). Extracted once a second admin page (site
// config, after app/admin/flags/page.tsx's original inline copies) needed
// the exact same pair — app/admin/flags/page.tsx keeps its own inline
// versions rather than being refactored to import these, to avoid touching
// working Stage 1 code for a one-line dedupe.

import { getSupabaseClient } from "@/lib/supabase/client";

/** The current session's access token, or null if signed out / unconfigured. */
export async function adminAuthToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** POSTs `body` as JSON to an `/api/admin/*` route with the given bearer
 *  token. Throws on a non-ok response; callers catch and show a generic
 *  error, same as app/admin/flags/page.tsx's `postFlags`. */
export async function adminPost(path: string, body: unknown, token: string): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("request failed");
}

/** GETs an `/api/admin/*` route with the given bearer token and parses the
 *  JSON response. Throws on a non-ok response. */
export async function adminGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("request failed");
  return (await res.json()) as T;
}
