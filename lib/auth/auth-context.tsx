"use client";

// Auth state for Registered Mode. Wraps Supabase Auth (email/password + OAuth,
// PRD §2.2) and degrades gracefully: when Supabase isn't configured, `mode` is
// always "guest" and the sign-in methods throw a clear error.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";
import { clearHistoryCache } from "../history/history-cache";

export type Mode = "guest" | "registered";

interface AuthContextValue {
  user: User | null;
  mode: Mode;
  loading: boolean;
  authAvailable: boolean;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signInWithOAuth(provider: "google" | "github"): Promise<void>;
  signOut(): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Only Supabase-configured sessions need an async session fetch; without it
  // we're immediately in (non-loading) Guest Mode.
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const supabase = useMemo(() => getSupabaseClient(), []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setUser(data.session?.user ?? null);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        setUser(session?.user ?? null);
      },
    );
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const requireSupabase = useCallback(() => {
    if (!supabase) {
      throw new Error(
        "Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable Registered Mode.",
      );
    }
    return supabase;
  }, [supabase]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      const sb = requireSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [requireSupabase],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      const sb = requireSupabase();
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      // When email confirmation is on, no session is returned yet.
      return { needsConfirmation: !data.session };
    },
    [requireSupabase],
  );

  const signInWithOAuth = useCallback(
    async (provider: "google" | "github") => {
      const sb = requireSupabase();
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo:
            typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) throw error;
    },
    [requireSupabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    // The history cache's keys are derived from the held instruments' price
    // keys (ISIN/WKN/symbol) — clear it so a shared device never surfaces one
    // user's chart data after another signs in.
    clearHistoryCache();
  }, [supabase]);

  const updatePassword = useCallback(
    async (newPassword: string) => {
      if (!supabase) throw new Error("Auth is not configured.");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    [supabase],
  );

  const value: AuthContextValue = {
    user,
    mode: user ? "registered" : "guest",
    loading,
    authAvailable: isSupabaseConfigured,
    signInWithPassword,
    signUp,
    signInWithOAuth,
    signOut,
    updatePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
