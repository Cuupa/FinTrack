// Supabase browser client (Registered Mode). The app is auth-interactive and
// client-rendered, so a single browser client covers auth + data access.
//
// When the env vars are absent the app still runs fully in Guest Mode —
// `isSupabaseConfigured` gates every registered-only path.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Prefer the new publishable key, fall back to the legacy anon key — both are
// RLS-scoped and safe in the browser (see lib/server/supabase-keys.ts for the
// server-side secret key, which must never reach this module).
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

let cached: SupabaseClient | null = null;

/** Returns the singleton browser client, or null if Supabase isn't configured. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!cached) {
    cached = createBrowserClient(url as string, publishableKey as string);
  }
  return cached;
}
