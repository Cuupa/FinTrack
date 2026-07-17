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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
      </head>
      {/* No overflow clipping on <body>: on iOS Safari that breaks the fixed
          bottom nav's stickiness. Horizontal overflow is contained on <main>
          instead, leaving the fixed MobileNav anchored to the viewport. */}
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <GuestBanner />
          {/* Needs FeatureFlagsProvider/LivePricesProvider, so it lives inside
              Providers — SW registration below stays unconditional. */}
          <OfflineBanner />
          <SiteNav />
          <div className="flex w-full">
            <Sidebar />
            {/* Window-wide content. pb leaves room for the fixed mobile tab bar. */}
            <main className="min-w-0 flex-1 overflow-x-clip px-4 py-5 pb-24 sm:px-6 md:pb-8 lg:px-8">
              {children}
              <LegalFooter />
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
