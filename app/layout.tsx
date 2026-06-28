import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteNav } from "@/components/site-nav";
import { MobileNav } from "@/components/mobile-nav";
import { GuestBanner } from "@/components/guest-banner";
import { LocaleBoundary } from "@/components/locale-boundary";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";

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
    >
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <GuestBanner />
          <SiteNav />
          {/* pb leaves room for the fixed mobile tab bar (MobileNav). */}
          <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:py-8 md:pb-8">
            <LocaleBoundary>{children}</LocaleBoundary>
          </main>
          <MobileNav />
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
