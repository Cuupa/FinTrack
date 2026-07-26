// Server-side counterpart of lib/errors/report.ts: writes into
// public.error_logs directly (secret client -- error_logs has no insert
// policy for anyone else), so a failure that never reaches the browser still
// shows up on /admin/errors.
//
// WHY: before this, the only errors that ever reached the log were client
// boundary/window/rejection events. An API route that answered 500 wrote its
// reason (e.g. `relation "public.plan_grants" does not exist`) into the JSON
// body and nowhere else -- the owner saw a bare "500" in the browser console
// and had nothing to debug from. Every deliberate 5xx now goes through
// `serverFail()`, and everything that throws goes through `onRequestError`
// (instrumentation.ts).
//
// Same three rules as the client reporter:
//   - NEVER throws. A logging failure must not become a second error, and
//     must never turn a handled 500 into an unhandled one.
//   - Honors the `errorLogging` feature flag (cached briefly, since a route
//     that fails usually fails in bursts and the flag is world-readable
//     config, not per-request state).
//   - No user id, no IP -- only the technical fields /datenschutz discloses.
//
// `kind` is "server" for everything written here; `route` carries the API
// path (or the pathname Next reports), matching what the client reporter
// puts there.

import "server-only";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import type { ErrorLevel } from "@/lib/errors/report";

const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const ROUTE_MAX = 200;
const DIGEST_MAX = 100;

const FLAG_TTL_MS = 60_000;

let flagValue = true;
let flagCheckedAt = 0;

function truncate(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Resets the cached `errorLogging` flag. Test-only. */
export function __resetFlagCacheForTests(): void {
  flagValue = true;
  flagCheckedAt = 0;
}

/** Missing row / unreachable table => enabled, the app-wide flag convention
 *  (lib/flags/flags-context.tsx) and the same default POST /api/errors uses. */
async function loggingEnabled(supabase: NonNullable<ReturnType<typeof supabaseSecret>>) {
  const now = Date.now();
  if (now - flagCheckedAt < FLAG_TTL_MS) return flagValue;
  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("flag", "errorLogging")
    .maybeSingle<{ enabled: boolean }>();
  flagValue = error || !data ? true : data.enabled;
  flagCheckedAt = now;
  return flagValue;
}

export interface ServerErrorEntry {
  message: string;
  stack?: string | null;
  /** API path or page pathname the failure happened on. */
  route?: string | null;
  /** Defaults to "error". */
  level?: ErrorLevel;
  /** Defaults to "server". */
  kind?: string;
  digest?: string | null;
}

/**
 * Inserts one row into error_logs. Callers await it (so the write lands
 * before a serverless function freezes) but it resolves rather than rejects
 * on every failure path.
 */
export async function logServerError(entry: ServerErrorEntry): Promise<void> {
  try {
    const supabase = supabaseSecret();
    if (!supabase) return;
    if (!(await loggingEnabled(supabase))) return;

    const row = {
      kind: entry.kind ?? "server",
      level: entry.level ?? "error",
      message: truncate(entry.message, MESSAGE_MAX),
      stack: truncate(entry.stack, STACK_MAX),
      route: truncate(entry.route, ROUTE_MAX),
      digest: truncate(entry.digest, DIGEST_MAX),
      user_agent: null,
    };

    const { error } = await supabase.from("error_logs").insert(row);
    if (!error) return;
    // Migration 0069 lag: a DB without the `level` column rejects the insert
    // above. Retry without it so a lagging DB still logs, same fallback as
    // app/api/errors/route.ts.
    await supabase.from("error_logs").insert({
      kind: row.kind,
      message: row.message,
      stack: row.stack,
      route: row.route,
      digest: row.digest,
      user_agent: row.user_agent,
    });
  } catch {
    // Logging must never throw.
  }
}

/**
 * The one way an API route answers 5xx: logs the reason, then returns the
 * JSON body callers already expect (`{ error }`, or `{ ok: false, error }`
 * where that route's contract says so).
 *
 * `detail` exists because several routes answer deliberately opaque
 * ("db error", "deletion failed") so an anonymous caller learns nothing about
 * the database. Logging that same word would be useless, so the underlying
 * message goes into the log entry only, never into the response body.
 */
export async function serverFail(
  route: string,
  message: string,
  options?: { status?: number; ok?: boolean; level?: ErrorLevel; detail?: string | null },
): Promise<Response> {
  const status = options?.status ?? 500;
  await logServerError({
    message: options?.detail ? `${message}: ${options.detail}` : message,
    route,
    level: options?.level ?? "error",
  });
  const body = options?.ok === false ? { ok: false, error: message } : { error: message };
  return Response.json(body, { status });
}
