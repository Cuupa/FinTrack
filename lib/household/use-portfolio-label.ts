"use client";

import { useCallback } from "react";
import type { Portfolio } from "@/lib/types";
import { useOwnerLabel } from "./use-owner-label";

/**
 * A depot's display label. In a sharing household it carries its owner
 * ("Broker · du" / "Broker · Gemeinsam"), since the depot is the owned unit and
 * this is the single place ownership is shown for investments. Outside a
 * household it is just the broker name.
 */
export function usePortfolioLabel() {
  const { shared, label } = useOwnerLabel();
  return useCallback(
    (portfolio: Pick<Portfolio, "name" | "ownerId" | "shared">): string => {
      const owner = shared ? label(portfolio.ownerId, portfolio.shared) : null;
      return owner ? `${portfolio.name} · ${owner}` : portfolio.name;
    },
    [shared, label],
  );
}
