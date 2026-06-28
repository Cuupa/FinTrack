"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/auth-context";
import { PortfolioProvider } from "@/lib/portfolio/portfolio-context";
import { CatalogProvider } from "@/lib/catalog/catalog-context";
import { LivePricesProvider } from "@/lib/live/live-prices-context";
import { PrivacyProvider } from "@/lib/privacy/privacy-context";
import { TagsProvider } from "@/lib/tags/tags-context";
import { I18nProvider } from "@/lib/i18n/i18n-context";
import { LocaleSync } from "@/components/locale-sync";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <CatalogProvider>
          <PortfolioProvider>
            <LivePricesProvider>
              <PrivacyProvider>
                <TagsProvider>
                  <LocaleSync />
                  {children}
                </TagsProvider>
              </PrivacyProvider>
            </LivePricesProvider>
          </PortfolioProvider>
        </CatalogProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
