"use client";

// Short-id shared portfolio: fetches the stored snapshot by id from /api/share.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { normalizeShare, type SharePayload } from "@/lib/share/share";
import { isSankeyShare, type SankeySharePayload } from "@/lib/share/sankey-share";
import { Card } from "@/components/ui/primitives";
import { SharedPortfolioView } from "@/components/shared/shared-portfolio-view";
import { SharedSankeyView } from "@/components/shared/shared-sankey-view";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function SharedByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const [payload, setPayload] = useState<SharePayload | SankeySharePayload | null | "missing">(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/api/share/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : { found: false }))
      .then((d: { found?: boolean; payload?: unknown }) => {
        if (cancelled) return;
        const raw = d.found ? d.payload : null;
        const p = isSankeyShare(raw) ? raw : normalizeShare(raw);
        setPayload(p ?? "missing");
      })
      .catch(() => {
        if (!cancelled) setPayload("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (payload === null) {
    return <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>;
  }
  if (payload === "missing") {
    return (
      <Card>
        <p className="text-sm text-zinc-500">
          {t("shared.notFound")}{" "}
          <Link href="/" className="text-emerald-600 hover:underline dark:text-emerald-400">
            {t("shared.goTo")}
          </Link>
        </p>
      </Card>
    );
  }
  if (isSankeyShare(payload)) return <SharedSankeyView payload={payload} />;
  return <SharedPortfolioView payload={payload} />;
}
