"use client";

// PRD §2.1: in Guest Mode, warn the user their data is not persisted.

import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";

export function GuestBanner() {
  const { mode, authAvailable } = useAuth();
  const { persistent } = usePortfolio();

  if (mode === "registered" || persistent) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
        <span aria-hidden>⚠️</span>
        <span>
          <strong>Guest Mode:</strong> your data is stored only in this browser
          and will be lost if you clear it.
        </span>
        {authAvailable && (
          <Link href="/login" className="font-semibold underline underline-offset-2">
            Sign up to save it
          </Link>
        )}
      </div>
    </div>
  );
}
