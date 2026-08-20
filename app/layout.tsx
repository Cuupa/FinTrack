import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteNav } from "@/components/site-nav";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { GuestBanner } from "@/components/guest-banner";
import { LegalFooter } from "@/components/legal-footer";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { DegradedBanner } from "@/components/portfolio/degraded-banner";
import { SyncPill } from "@/components/offline/sync-pill";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ChatBubble } from "@/components/llm/chat-bubble";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinTrack",
  description: "Financial simulation and asset tracking.",
  applicationName: "FinTrack",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FinTrack",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme bootstrap: applies the "dark" class before first
            paint, from the explicit choice (localStorage) or else the OS
            preference. Kept inline (CSP allows script-src 'unsafe-inline')
            because it must run before any CSS/React paints. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('fintrack-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('fintrack-incognito')==='1')document.documentElement.classList.add('incognito')}catch(e){}",
          }}
        />
      </head>
      {/* Two rules keep the fixed bottom nav pinned on a phone.
          1. No overflow clipping on <body>: on iOS Safari that breaks the
             fixed bottom nav's stickiness. Horizontal overflow is contained on
             <main> instead, leaving MobileNav anchored to the viewport.
          2. `min-h-dvh`, not a percentage chain. `html { height: 100% }` +
             `body { min-height: 100% }` resolves against the LAYOUT viewport,
             which on mobile Safari does not change as the URL bar collapses —
             so the document ends up taller than the visual viewport and a
             `position: fixed; bottom: 0` bar drifts with the scroll instead of
             staying put. The dynamic viewport unit tracks the real thing, and
             it needs no height on <html> at all. */}
      <body className="min-h-dvh bg-app text-primary">
        <Providers>
          <GuestBanner />
          {/* Needs FeatureFlagsProvider/LivePricesProvider, so it lives inside
              Providers — SW registration below stays unconditional. */}
          <OfflineBanner />
          <DegradedBanner />
          <SiteNav />
          <div className="flex w-full">
            <Sidebar />
            {/* Content is centered and capped at 1480px (UX-Unification-Spec
                §4.2), with the responsive 16/24/32px gutters. pb leaves room
                for the fixed mobile tab bar. */}
            <main className="min-w-0 flex-1 overflow-x-clip px-4 py-5 pb-24 sm:px-6 md:pb-8 lg:px-8">
              <div className="mx-auto w-full max-w-[1480px]">
                {children}
                <LegalFooter />
              </div>
            </main>
          </div>
          <MobileNav />
          {/* Global, not page-local (unlike the CSV-import pill in
              app/page.tsx) — reconnect sync can finish while the user is on
              any route. */}
          <SyncPill />
          <ChatBubble />
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
