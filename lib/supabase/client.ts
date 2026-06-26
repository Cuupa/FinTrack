// Supabase browser client (Registered Mode). The app is auth-interactive and
// client-rendered, so a single browser client covers auth + data access.
//
// When the env vars are absent the app still runs fully in Guest Mode —
// `isSupabaseConfigured` gates every registered-only path.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let cached: SupabaseClient | null = null;

/** Returns the singleton browser client, or null if Supabase isn't configured. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!cached) {
    cached = createBrowserClient(url as string, anonKey as string);
  }
  return cached;
}
