"use client";

import { SettingsView } from "@/components/settings/settings-view";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500">Your profile, language, and security.</p>
      </div>
      <SettingsView />
    </div>
  );
}
