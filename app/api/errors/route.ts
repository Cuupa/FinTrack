// Receives client-reported errors from lib/errors/report.ts (app/error.tsx,
// app/global-error.tsx, components/error-reporter.tsx) and inserts them into
// public.error_logs for the /admin/errors viewer. No authentication — a
// boundary can fire for a signed-out guest too — protected instead by a
// per-IP rate limit and the `errorLogging` feature flag (server-checked
// here since the caller may not have a hook available; see app/error.tsx).
// Stores NO user id and NO IP address, only the technical fields disclosed
// in /datenschutz.
//
// Deliberately never a 500: a reporting hiccup must not itself look like an
// error worth reporting. Unavailable (no Supabase / flag off) is 204;
// malformed input is 400; over the rate limit is 429 (the shared
// rateLimit/tooManyRequests helper, same as /api/lookup); success is 204.

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const KIND_ALLOWLIST = new Set(["boundary", "window", "unhandledrejection"]);
const LEVEL_ALLOWLIST = new Set(["debug", "info", "warn", "error", "fatal"]);
const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const ROUTE_MAX = 200;
const DIGEST_MAX = 100;
const USER_AGENT_MAX = 300;

function truncate(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Missing row => enabled, matching the app-wide feature-flag convention
 *  (lib/flags/flags-context.tsx: "a flag missing from the table counts as
 *  enabled"). This route has no per-user override concept — errors are
 *  reported before we necessarily know who the user is. */
async function errorLoggingEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("flag", "errorLogging")
    .maybeSingle();
  if (error || !data) return true;
  return data.enabled;
}

export async function POST(req: Request): Promise<Response> {
  const supabase = supabaseSecret();
  if (!supabase) return new Response(null, { status: 204 });

  if (!(await rateLimit("errors", req, 30, 60))) return tooManyRequests();

  if (!(await errorLoggingEnabled(supabase))) return new Response(null, { status: 204 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const kind = typeof body.kind === "string" && KIND_ALLOWLIST.has(body.kind) ? body.kind : null;
  if (!kind) return Response.json({ error: "invalid kind" }, { status: 400 });

  // Absent level defaults to "error" (matching reportError()'s own default,
  // so a caller too old to send one still logs correctly); an explicitly
  // invalid level is rejected same as an invalid kind.
  const level = body.level === undefined ? "error" : body.level;
  if (typeof level !== "string" || !LEVEL_ALLOWLIST.has(level)) {
    return Response.json({ error: "invalid level" }, { status: 400 });
  }

  const row = {
    kind,
    level,
    message: truncate(body.message, MESSAGE_MAX),
    stack: truncate(body.stack, STACK_MAX),
    route: truncate(body.route, ROUTE_MAX),
    digest: truncate(body.digest, DIGEST_MAX),
    user_agent: truncate(req.headers.get("user-agent"), USER_AGENT_MAX),
  };

  const { error } = await supabase.from("error_logs").insert(row);
  if (error) {
    // Migration 0069 lag: a prod DB that hasn't applied 0069 yet has no
    // `level` column, so the insert above fails with "unknown column" and
    // would otherwise silently drop every report until the owner migrates —
    // worse than pre-0069 behavior, which stored the row fine. Retry once
    // without `level` so a lagging DB behaves exactly as before (same
    // convention as migration 0065 in CLAUDE.md: a DB behind on a migration
    // must never regress, just miss the new column). Still never a 500
    // either way.
    const rowWithoutLevel = {
      kind: row.kind,
      message: row.message,
      stack: row.stack,
      route: row.route,
      digest: row.digest,
      user_agent: row.user_agent,
    };
    const retry = await supabase.from("error_logs").insert(rowWithoutLevel);
    if (retry.error) return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}
