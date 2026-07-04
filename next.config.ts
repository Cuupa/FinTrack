import type { NextConfig } from "next";

// Security headers. CSP is only emitted in production — Turbopack's dev
// server needs 'unsafe-eval' (and injects its own inline scripts/HMR
// websocket) that we don't want to also allow in production.
const isProd = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  // Next injects an inline bootstrap script; nonce-based CSP would require
  // middleware rewrites of every response, which is out of scope here.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind / inline styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Supabase auth/REST/realtime are called directly from the browser (the
  // `@supabase/ssr` client), so the project origin needs to be reachable.
  // Market-data APIs (Yahoo, Stooq, Frankfurter, CoinGecko, SlickCharts) are
  // only ever called server-side (app/api/*, lib/server/*) — deliberately
  // NOT allowed here.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No page in the app embeds third-party content in an <iframe>, and
  // /shared/[id] (share links) isn't designed to be embedded either — so
  // frame-ancestors/X-Frame-Options are locked down everywhere.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
