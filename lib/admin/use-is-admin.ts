"use client";

// Whether the signed-in user is an admin, read directly from `public.admins`
// via the browser client. RLS policy "own admin row" (migration 0050) lets a
// user select only their own row, so a non-admin's query simply returns no
// row: the client can never enumerate the admin list. Settles immediately
// to { isAdmin: false, loading: false } when Supabase isn't configured
// (Guest Mode has no admin concept) or the user is signed out.
//
// While AuthProvider is still restoring the Supabase session (a hard
// navigation straight to /admin: `useAuth().user` is transiently null with
// `loading: true`), this must report `loading: true` too rather than
// settling on `isAdmin: false`, otherwise app/admin/layout.tsx's redirect
// effect fires and bounces a real admin to "/" before auth even resolves.

import { useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";
import { useAuth } from "../auth/auth-context";

interface UseIsAdminResult {
  isAdmin: boolean;
  loading: boolean;
}

export function useIsAdmin(): UseIsAdminResult {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  // Tagged with the user id it was resolved for, same pattern as
  // FeatureFlagsProvider's `overrides` state: a sign-out/switch needs no
  // reset-in-effect, the derivation below just stops matching.
  const [resolved, setResolved] = useState<{ userId: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) return;
    let active = true;
    supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setResolved({ userId, isAdmin: Boolean(data) });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  if (!isSupabaseConfigured) return { isAdmin: false, loading: false };
  if (authLoading) return { isAdmin: false, loading: true };
  if (!userId) return { isAdmin: false, loading: false };
  if (resolved?.userId !== userId) return { isAdmin: false, loading: true };
  return { isAdmin: resolved.isAdmin, loading: false };
}
