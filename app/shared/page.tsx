"use client";

// Fragment-based shared portfolio (fallback when no backend is configured): the
// snapshot is decoded entirely from the URL fragment — nothing is fetched.

import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeShareAny, type SharePayload } from "@/lib/share/share";
import { isSankeyShare, type SankeySharePayload } from "@/lib/share/sankey-share";
import { Card } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { SharedPortfolioView } from "@/components/shared/shared-portfolio-view";
import { SharedSankeyView } from "@/components/shared/shared-sankey-view";

export default function SharedFragmentPage() {
  const [payload, setPayload] = useState<SharePayload | SankeySharePayload | null | "missing">(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const frag = window.location.hash.replace(/^#/, "");
      setPayload(frag ? (decodeShareAny(frag) ?? "missing") : "missing");
    });
  }, []);

  if (payload === null) {
    // Skeleton, not a "Loading…" label: the project rule is placeholders
    // that match the shape of what is coming, and this text was also the
    // only untranslated string on an otherwise English-by-design surface.
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
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
  if (isSankeyShare(payload)) return <SharedSankeyView payload={payload} />;
  return <SharedPortfolioView payload={payload} />;
}
