"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/auth-context";
import { PortfolioProvider } from "@/lib/portfolio/portfolio-context";
import { CatalogProvider } from "@/lib/catalog/catalog-context";
import { LivePricesProvider } from "@/lib/live/live-prices-context";
import { PrivacyProvider } from "@/lib/privacy/privacy-context";
import { TagsProvider } from "@/lib/tags/tags-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CatalogProvider>
        <PortfolioProvider>
          <LivePricesProvider>
            <PrivacyProvider>
              <TagsProvider>{children}</TagsProvider>
            </PrivacyProvider>
          </LivePricesProvider>
        </PortfolioProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}
