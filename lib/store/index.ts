// Chooses the active store based on auth state: a signed-in Supabase user
// gets persistent cloud storage, everyone else gets the local guest store.

import type { SupabaseClient } from "@supabase/supabase-js";
import { LocalStore } from "./local-store";
import { SupabaseStore } from "./supabase-store";
import type { DataStore } from "./types";

export function createStore(
  supabase: SupabaseClient | null,
  userId: string | null,
): DataStore {
  if (supabase && userId) return new SupabaseStore(supabase, userId);
  const storage =
    typeof window !== "undefined" ? window.localStorage : undefined;
  return new LocalStore(storage);
}

export type { DataStore } from "./types";
export { LocalStore } from "./local-store";
export { SupabaseStore } from "./supabase-store";
