"use client";

import { XrayView } from "@/components/xray/xray-view";

export default function XrayPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio X-ray</h1>
        <p className="text-sm text-zinc-500">
          Your true exposure to individual stocks, looking through your funds.
        </p>
      </div>
      <XrayView />
    </div>
  );
}
