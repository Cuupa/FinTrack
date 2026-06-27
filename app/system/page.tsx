"use client";

// System page: shows which database migrations have been applied.

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui/primitives";

interface Migration {
  version: string;
  applied_at: string;
}

export default function SystemPage() {
  const [migrations, setMigrations] = useState<Migration[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/migrations")
      .then((r) => (r.ok ? r.json() : { migrations: [] }))
      .then((d: { migrations?: Migration[] }) => {
        if (!cancelled) setMigrations(d.migrations ?? []);
      })
      .catch(() => {
        if (!cancelled) setMigrations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">System</h1>
        <p className="text-sm text-zinc-500">Database migrations applied to this instance.</p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">Migrations</h2>
        {migrations === null ? (
          <p className="mt-3 text-sm text-zinc-500">Loading…</p>
        ) : migrations.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            None recorded (Supabase not configured, or the schema_migrations table is empty).
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Version</th>
                <th className="py-2 pr-3 text-right">Applied</th>
              </tr>
            </thead>
            <tbody>
              {migrations.map((m) => (
                <tr key={m.version} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="py-2 pr-3 font-mono text-xs">{m.version}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">
                    {m.applied_at ? formatDateTime(m.applied_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
