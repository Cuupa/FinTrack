"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/auth-context";
import { FeatureFlagsProvider } from "@/lib/flags/flags-context";
import { PortfolioProvider } from "@/lib/portfolio/portfolio-context";
import { CatalogProvider } from "@/lib/catalog/catalog-context";
import { LivePricesProvider } from "@/lib/live/live-prices-context";
import { SyncProvider } from "@/lib/offline/sync-context";
import { PrivacyProvider } from "@/lib/privacy/privacy-context";
import { TagsProvider } from "@/lib/tags/tags-context";
import { I18nProvider } from "@/lib/i18n/i18n-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { LocaleSync } from "@/components/locale-sync";
import { ErrorReporter } from "@/components/error-reporter";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <FeatureFlagsProvider>
            <CatalogProvider>
              <PortfolioProvider>
                {/* Needs the store from PortfolioProvider (OFFLINE_DESIGN.md §2
                    phase 3) — sits just inside it, same as every other provider
                    here that depends on portfolio data. */}
                <SyncProvider>
                  <LivePricesProvider>
                    <PrivacyProvider>
                      <TagsProvider>
                        <LocaleSync />
                        <ErrorReporter />
                        {children}
                      </TagsProvider>
                    </PrivacyProvider>
                  </LivePricesProvider>
                </SyncProvider>
              </PortfolioProvider>
            </CatalogProvider>
          </FeatureFlagsProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
