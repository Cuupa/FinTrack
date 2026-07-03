// Chooses the active store based on auth state: a signed-in Supabase user
// gets persistent cloud storage, everyone else gets the local guest store.

import type { SupabaseClient } from "@supabase/supabase-js";
import { LocalStore } from "./local-store";
import { OfflineStore } from "./offline-store";
import { SupabaseStore } from "./supabase-store";
import type { DataStore } from "./types";

/**
 * `offlineEnabled` gates the `offline` feature flag (OFFLINE_DESIGN.md §2
 * phase 2). Flags live in Postgres and are only readable through React
 * (`useFeatureFlag`, `lib/flags/flags-context.tsx`) — this function is plain
 * and called outside React, so the caller (`PortfolioProvider`) resolves the
 * flag via `useFeatureFlag("offline")` and threads the value in here, the
 * same way it already threads `user.id`.
 */
export function createStore(
  supabase: SupabaseClient | null,
  userId: string | null,
  offlineEnabled = false,
): DataStore {
  if (supabase && userId) {
    const inner = new SupabaseStore(supabase, userId);
    return offlineEnabled ? new OfflineStore(inner, userId) : inner;
  }
  const storage =
    typeof window !== "undefined" ? window.localStorage : undefined;
  return new LocalStore(storage);
}

export type { DataStore } from "./types";
export { LocalStore } from "./local-store";
export { OfflineStore } from "./offline-store";
export { SupabaseStore } from "./supabase-store";
