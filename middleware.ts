// API gateway. Two coarse rules, enforced at the edge:
//
//  1. /api/cron/* is server-to-server only. When CRON_SECRET is configured it
//     MUST carry `Authorization: Bearer $CRON_SECRET`. The browser never calls
//     these routes; only the scheduler / sync orchestrator does.
//  2. Every other /api/* route honors an optional bearer-token gate: enforced
//     only when API_TOKEN is configured (so the app runs open by default and
//     the world-readable market-data proxies keep working in Guest Mode).
//     Accepts the browser token (API_TOKEN, matched by NEXT_PUBLIC_API_TOKEN
//     client-side) or the CRON_SECRET.
//
// User-specific mutation endpoints (account deletion, share writes) verify the
// caller's Supabase session / a secret key inside the route itself; middleware
// deliberately does not require a session here, since that would lock Guest
// Mode out of the public market-data endpoints.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest): NextResponse {
  const auth = req.headers.get("authorization");
  const cron = process.env.CRON_SECRET;

  if (req.nextUrl.pathname.startsWith("/api/cron")) {
    if (cron && auth !== `Bearer ${cron}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // The Stripe webhook authenticates via its signature header, not a bearer
  // token — Stripe cannot send our API_TOKEN. Exempt it from the token gate so
  // it stays reachable when API_TOKEN is configured; the route itself verifies
  // the Stripe signature before trusting the body.
  if (req.nextUrl.pathname === "/api/billing/webhook") {
    return NextResponse.next();
  }

  const apiToken = process.env.API_TOKEN;
  if (!apiToken) return NextResponse.next(); // not enforced unless configured

  const ok = auth === `Bearer ${apiToken}` || (!!cron && auth === `Bearer ${cron}`);
  if (ok) return NextResponse.next();

  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = { matcher: "/api/:path*" };
