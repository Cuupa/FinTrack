"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/auth-context";
import { BillingProvider } from "@/lib/billing/billing-context";
import { FeatureFlagsProvider } from "@/lib/flags/flags-context";
import { PortfolioProvider } from "@/lib/portfolio/portfolio-context";
import { CatalogProvider } from "@/lib/catalog/catalog-context";
import { LivePricesProvider } from "@/lib/live/live-prices-context";
import { SyncProvider } from "@/lib/offline/sync-context";
import { PrivacyProvider } from "@/lib/privacy/privacy-context";
import { TagsProvider } from "@/lib/tags/tags-context";
import { LlmConfigProvider } from "@/lib/llm/llm-context";
import { I18nProvider } from "@/lib/i18n/i18n-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { LocaleSync } from "@/components/locale-sync";
import { ThemeSync } from "@/components/theme-sync";
import { ErrorReporter } from "@/components/error-reporter";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          {/* Above FeatureFlagsProvider: plan-gated flag resolution
              (lib/flags/resolve.ts) consumes usePlan(), which reads this
              context (lib/billing/use-plan.ts). */}
          <BillingProvider>
            <FeatureFlagsProvider>
              <CatalogProvider>
                <PortfolioProvider>
                  {/* Needs the store from PortfolioProvider (OFFLINE_DESIGN.md §2
                      phase 3), sits just inside it, same as every other provider
                      here that depends on portfolio data. LlmConfigProvider is a
                      thin adapter over usePortfolio() (round-22 tags precedent),
                      so it lives at this level too, not at the top like before
                      the config moved onto the DataStore seam. */}
                  <SyncProvider>
                    <LivePricesProvider>
                      <PrivacyProvider>
                        <TagsProvider>
                          <LlmConfigProvider>
                            <LocaleSync />
                            <ThemeSync />
                            <ErrorReporter />
                            {children}
                          </LlmConfigProvider>
                        </TagsProvider>
                      </PrivacyProvider>
                    </LivePricesProvider>
                  </SyncProvider>
                </PortfolioProvider>
              </CatalogProvider>
            </FeatureFlagsProvider>
          </BillingProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
