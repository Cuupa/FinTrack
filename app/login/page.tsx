"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";

// Only new passwords (signup, change-password) are floored at this length;
// sign-in never enforces a minLength so existing shorter passwords still work.
const NEW_PASSWORD_MIN_LENGTH = 8;

const BACKOFF_KEY = "fintrack_login_backoff";
function readBackoff(): { fails: number; until: number } {
  if (typeof window === "undefined") return { fails: 0, until: 0 };
  try {
    const raw = window.sessionStorage.getItem(BACKOFF_KEY);
    if (raw) return JSON.parse(raw) as { fails: number; until: number };
  } catch {
    /* ignore */
  }
  return { fails: 0, until: 0 };
}

/** Whether new registrations are currently allowed (below the user cap). */
async function checkRegistrationOpen(): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return true;
  try {
    const { data, error } = await supabase.rpc("registration_open");
    if (error) return true; // fail open — don't block signups on a check error
    return data !== false;
  } catch {
    return true;
  }
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md py-8">
          <div className="h-80 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const { user, authAvailable, signInWithPassword, signUp, signInWithOAuth } =
    useAuth();
  // Open the register tab when arriving via /login?tab=signup.
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<"signin" | "signup">(
    initialTab === "signup" || initialTab === "register" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = not yet checked; false = registrations closed (user cap reached).
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null);
  // Exponential-backoff cooldown after repeated failed sign-in attempts.
  const [fails, setFails] = useState<number>(() => readBackoff().fails);
  const [cooldownUntil, setCooldownUntil] = useState<number>(
    () => readBackoff().until,
  );
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const cooldownRemaining = Math.max(
    0,
    Math.ceil((cooldownUntil - nowTick) / 1000),
  );

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  useEffect(() => {
    if (!authAvailable) return;
    let cancelled = false;
    checkRegistrationOpen().then((open) => {
      if (!cancelled) setSignupOpen(open);
    });
    return () => {
      cancelled = true;
    };
  }, [authAvailable]);

  function persistBackoff(nextFails: number, until: number) {
    setFails(nextFails);
    setCooldownUntil(until);
    try {
      window.sessionStorage.setItem(
        BACKOFF_KEY,
        JSON.stringify({ fails: nextFails, until }),
      );
    } catch {
      /* ignore */
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldownRemaining > 0) {
      setError(t("login.tooManyAttempts", { s: cooldownRemaining }));
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (tab === "signin") {
        await signInWithPassword(email, password);
        persistBackoff(0, 0);
        router.replace("/");
      } else {
        if (password.length < NEW_PASSWORD_MIN_LENGTH) {
          throw new Error(
            t("login.passwordTooShort", { n: NEW_PASSWORD_MIN_LENGTH }),
          );
        }
        if (password !== confirmPassword) {
          throw new Error(t("login.passwordMismatch"));
        }
        // Re-check the cap at submit time (it may have filled since page load).
        if (!(await checkRegistrationOpen())) {
          setSignupOpen(false);
          throw new Error(t("login.registrationsClosedShort"));
        }
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setMessage(t("login.confirmEmail"));
        } else {
          router.replace("/");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.genericError"));
      if (tab === "signin") {
        const nextFails = fails + 1;
        const until =
          nextFails >= 3
            ? Date.now() + Math.min(300, 5 * 2 ** (nextFails - 3)) * 1000
            : 0;
        persistBackoff(nextFails, until);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleOAuth(provider: "google" | "github") {
    setError(null);
    try {
      await signInWithOAuth(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.genericError"));
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <h1 className="text-2xl font-semibold">
          {tab === "signin" ? t("login.signIn") : t("login.createAccount")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{t("login.subtitle")}</p>

        {!authAvailable && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            {t("login.authUnavailablePrefix")}{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            {t("login.authUnavailableMiddle")}{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
            {t("login.authUnavailableSuffix")}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="email">
              {t("login.email")}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              disabled={!authAvailable || busy}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="password">
              {t("login.password")}
            </label>
            <input
              id="password"
              type="password"
              required
              // The minimum only applies when creating an account; sign-in
              // accepts whatever the user already has.
              minLength={tab === "signup" ? NEW_PASSWORD_MIN_LENGTH : undefined}
              autoComplete={tab === "signin" ? "current-password" : "new-password"}
              value={password}
              disabled={!authAvailable || busy}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            />
            {tab === "signup" && (
              <p className="mt-1 text-xs text-zinc-500">
                {t("login.passwordHint", { n: NEW_PASSWORD_MIN_LENGTH })}
              </p>
            )}
          </div>

          {tab === "signup" && (
            <div>
              <label className="text-sm font-medium" htmlFor="confirm-password">
                {t("login.retypePassword")}
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={NEW_PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={confirmPassword}
                disabled={!authAvailable || busy}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              />
            </div>
          )}

          {tab === "signup" && signupOpen === false && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              {t("login.registrationsClosedBanner")}
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {message && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
          )}
          {tab === "signin" && cooldownRemaining > 0 && (
            <p className="text-xs text-zinc-500">
              {t("login.tooManyAttempts", { s: cooldownRemaining })}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={
              !authAvailable ||
              busy ||
              cooldownRemaining > 0 ||
              (tab === "signup" && signupOpen === false)
            }
          >
            {tab === "signin" ? t("login.signIn") : t("login.createAccount")}
          </Button>
        </form>

        {tab === "signup" && (
          <p className="mt-3 text-xs text-zinc-500">
            {t("login.consentPrefix")}{" "}
            <Link href="/terms" className="underline underline-offset-2">
              {t("legal.terms")}
            </Link>{" "}
            {t("login.consentMiddle")}{" "}
            <Link href="/datenschutz" className="underline underline-offset-2">
              {t("login.privacyPolicyLink")}
            </Link>
            {t("login.consentSuffix")}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="w-full"
            disabled={!authAvailable}
            onClick={() => handleOAuth("google")}
          >
            {t("login.google")}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!authAvailable}
            onClick={() => handleOAuth("github")}
          >
            {t("login.github")}
          </Button>
        </div>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {tab === "signin" ? t("login.noAccountYet") : t("login.alreadyHaveAccount")}{" "}
          <button
            className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
            onClick={() => {
              setTab(tab === "signin" ? "signup" : "signin");
              setError(null);
              setMessage(null);
              setConfirmPassword("");
            }}
          >
            {tab === "signin" ? t("login.createOne") : t("login.signIn")}
          </button>
        </p>
      </Card>
    </div>
  );
}
