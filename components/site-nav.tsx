"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "./ui/primitives";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/allocation", label: "Allocation" },
  { href: "/xray", label: "X-Ray" },
  { href: "/planning", label: "Planning" },
];

export function SiteNav() {
  const pathname = usePathname();
  const { user, mode, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Fin<span className="text-emerald-600 dark:text-emerald-400">Track</span>
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {mode === "registered" ? (
            <>
              <span className="hidden text-sm text-zinc-500 sm:inline">
                {user?.email}
              </span>
              <Button variant="secondary" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="secondary">Log in</Button>
              </Link>
              <Link href="/login?tab=signup">
                <Button variant="primary">Register</Button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
