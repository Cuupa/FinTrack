// Centralized Supabase key selection for server-side API routes (app/api/**).
//
// Supabase's current key format uses a `sk_...` "secret" key and a `pk_...`
// "publishable" key, replacing the legacy `service_role` / `anon` JWTs. Both
// formats still work; every lookup here prefers the new var and falls back to
// the legacy one so existing deploys keep working without a key rotation.
//
//   - secretKey() / supabaseSecret()
//     Bypasses Row Level Security entirely. Use ONLY where a route writes a
//     GLOBAL reference table that has no RLS write policy for
//     authenticated/anon (see the "Row-level security" section of
//     supabase/schema.sql) — e.g. the instruments/constituents/etf_breakdowns/
//     instrument_history/benchmark_history caches, all written by crons or
//     server-only endpoints, never by a client. Never import this from
//     anything that can end up in a client bundle.
//   - publishableKey() / supabasePublishable()
//     RLS-scoped — the same key the browser client uses. Safe everywhere:
//     world-readable reads (catalog, breakdowns, migrations, shares) and
//     user-scoped operations that rely on auth.uid() policies. Also correct
//     for tables whose RLS *does* grant the needed write to anon/authenticated
//     (e.g. `shared_portfolios`' `insert ... with check (true)` policy —
//     that one needs no bypass at all).
//
// LEAK RESEARCH: Next.js only inlines env vars prefixed `NEXT_PUBLIC_` into
// client bundles at build time; anything without that prefix (SUPABASE_SECRET_KEY,
// SUPABASE_SERVICE_ROLE_KEY) exists solely in the server/Node runtime and is
// never bundled for the browser. Verified empirically: after `npm run build`,
// grepping .next/static/chunks for "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"
// and "service_role" returns zero hits (see task report for the exact grep run).

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function url(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** RLS-bypassing key. Prefer the new secret key, fall back to the legacy service role key. */
export function secretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** RLS-scoped key. Prefer the new publishable key, fall back to the legacy anon key. */
export function publishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Server client with the secret key (bypasses RLS), or null if unconfigured. */
export function supabaseSecret(): SupabaseClient | null {
  const u = url();
  const k = secretKey();
  return u && k ? createClient(u, k) : null;
}

/** Server client with the publishable key (RLS-scoped), or null if unconfigured. */
export function supabasePublishable(): SupabaseClient | null {
  const u = url();
  const k = publishableKey();
  return u && k ? createClient(u, k) : null;
}
