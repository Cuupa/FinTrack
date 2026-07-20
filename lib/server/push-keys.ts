// VAPID credential resolution for web push (COMPETITION.md F5), mirroring
// lib/server/billing-keys.ts exactly: the owner can set the keys at runtime in
// `app_settings` (id=1, RLS enabled with zero policies -> service role only),
// and they win over the env fallback (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
// / `VAPID_SUBJECT`) so existing env-only deploys keep working.
//
// `resolveVapidValue` is the pure precedence rule, exported separately so tests
// exercise it without a Supabase mock (repo convention).

import "server-only";
import { supabaseSecret } from "./supabase-keys";

export interface VapidKeys {
  publicKey: string | null;
  privateKey: string | null;
  /** `mailto:` or https contact, required by the push spec. Falls back to a
   *  neutral placeholder so a missing subject never blocks a configured key. */
  subject: string;
}

interface AppSettingsVapidRow {
  vapid_public_key: string | null;
  vapid_private_key: string | null;
  vapid_subject: string | null;
}

/** A DB value wins when it is a non-empty (post-trim) string; otherwise the env
 *  var, or null if that is unset too. */
export function resolveVapidValue(dbValue: unknown, envValue: string | undefined): string | null {
  if (typeof dbValue === "string" && dbValue.trim() !== "") return dbValue;
  return envValue && envValue.trim() !== "" ? envValue : null;
}

const DEFAULT_SUBJECT = "mailto:noreply@fintrack.app";

/** Resolve all VAPID credentials for this request. Reads `app_settings` once
 *  via the service-role client; a missing Supabase config or a DB error falls
 *  back to env (never throws). */
export async function getVapidKeys(): Promise<VapidKeys> {
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  const envSubject = process.env.VAPID_SUBJECT;

  const admin = supabaseSecret();
  if (!admin) {
    return {
      publicKey: resolveVapidValue(undefined, envPub),
      privateKey: resolveVapidValue(undefined, envPriv),
      subject: resolveVapidValue(undefined, envSubject) ?? DEFAULT_SUBJECT,
    };
  }

  const { data, error } = await admin
    .from("app_settings")
    .select("vapid_public_key, vapid_private_key, vapid_subject")
    .eq("id", 1)
    .maybeSingle<AppSettingsVapidRow>();

  if (error || !data) {
    return {
      publicKey: resolveVapidValue(undefined, envPub),
      privateKey: resolveVapidValue(undefined, envPriv),
      subject: resolveVapidValue(undefined, envSubject) ?? DEFAULT_SUBJECT,
    };
  }

  return {
    publicKey: resolveVapidValue(data.vapid_public_key, envPub),
    privateKey: resolveVapidValue(data.vapid_private_key, envPriv),
    subject: resolveVapidValue(data.vapid_subject, envSubject) ?? DEFAULT_SUBJECT,
  };
}
