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

/** Builds the Error thrown for a non-ok admin response, carrying the route's
 *  own `{ error }` message. These pages are owner-only, so the actual reason
 *  ("relation \"public.plan_grants\" does not exist") belongs on screen —
 *  a generic "request failed" left the owner with a broken card and nothing
 *  to act on. */
async function requestFailed(res: Response): Promise<Error> {
  let detail: string | null = null;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) detail = body.error;
  } catch {
    // Non-JSON body (a gateway error page): the status alone has to do.
  }
  return new Error(detail ? `${res.status}: ${detail}` : `request failed (${res.status})`);
}

/** POSTs `body` as JSON to an `/api/admin/*` route with the given bearer
 *  token. Throws on a non-ok response; callers catch and show the message,
 *  same as app/admin/flags/page.tsx's `postFlags`. */
export async function adminPost(path: string, body: unknown, token: string): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await requestFailed(res);
}

/** GETs an `/api/admin/*` route with the given bearer token and parses the
 *  JSON response. Throws on a non-ok response. */
export async function adminGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw await requestFailed(res);
  return (await res.json()) as T;
}

/** DELETEs to an `/api/admin/*` route with `body` as JSON and the given
 *  bearer token, returning the parsed JSON response. Throws on a non-ok
 *  response, same contract as adminPost. */
export async function adminDelete<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await requestFailed(res);
  return (await res.json()) as T;
}
