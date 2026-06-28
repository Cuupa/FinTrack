"use client";

// Fragment-based shared portfolio (fallback when no backend is configured): the
// snapshot is decoded entirely from the URL fragment — nothing is fetched.

import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeShare, type SharePayload } from "@/lib/share/share";
import { Card } from "@/components/ui/primitives";
import { SharedPortfolioView } from "@/components/shared/shared-portfolio-view";

export default function SharedFragmentPage() {
  const [payload, setPayload] = useState<SharePayload | null | "missing">(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const frag = window.location.hash.replace(/^#/, "");
      setPayload(frag ? (decodeShare(frag) ?? "missing") : "missing");
    });
  }, []);

  if (payload === null) {
    return <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>;
  }
  if (payload === "missing") {
    return (
      <Card>
        <p className="text-sm text-zinc-500">
          This share link is empty or invalid.{" "}
          <Link href="/" className="text-emerald-600 hover:underline dark:text-emerald-400">
            Go to FinTrack
          </Link>
        </p>
      </Card>
    );
  }
  return <SharedPortfolioView payload={payload} />;
}
