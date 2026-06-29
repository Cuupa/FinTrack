"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { Button, Card } from "@/components/ui/primitives";

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

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (tab === "signin") {
        await signInWithPassword(email, password);
        router.replace("/");
      } else {
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setMessage("Check your email to confirm your account, then sign in.");
        } else {
          router.replace("/");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOAuth(provider: "google" | "github") {
    setError(null);
    try {
      await signInWithOAuth(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <h1 className="text-2xl font-semibold">
          {tab === "signin" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Registered Mode syncs your portfolio across devices.
        </p>

        {!authAvailable && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Authentication is not configured. Add{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
            enable sign-in. You can still use everything in Guest Mode.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              disabled={!authAvailable || busy}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              // The 6-character minimum only applies when creating an account;
              // sign-in accepts whatever the user already has.
              minLength={tab === "signup" ? 6 : undefined}
              autoComplete={tab === "signin" ? "current-password" : "new-password"}
              value={password}
              disabled={!authAvailable || busy}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            />
            {tab === "signup" && (
              <p className="mt-1 text-xs text-zinc-500">At least 6 characters.</p>
            )}
          </div>

          {tab === "signup" && (
            <div>
              <label className="text-sm font-medium" htmlFor="confirm-password">
                Retype password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                disabled={!authAvailable || busy}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {message && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!authAvailable || busy}
          >
            {tab === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="w-full"
            disabled={!authAvailable}
            onClick={() => handleOAuth("google")}
          >
            Google
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!authAvailable}
            onClick={() => handleOAuth("github")}
          >
            GitHub
          </Button>
        </div>

        <p className="mt-5 text-center text-sm text-zinc-500">
          {tab === "signin" ? "No account yet?" : "Already have an account?"}{" "}
          <button
            className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
            onClick={() => {
              setTab(tab === "signin" ? "signup" : "signin");
              setError(null);
              setMessage(null);
              setConfirmPassword("");
            }}
          >
            {tab === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </Card>
    </div>
  );
}
