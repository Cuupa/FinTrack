// API gateway: requires a bearer token on every /api route. Enforced only when
// API_TOKEN is configured (so the app runs open by default). Accepts the
// browser token (API_TOKEN, matched by NEXT_PUBLIC_API_TOKEN client-side) or the
// CRON_SECRET (used by cron/server-to-server calls).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest): NextResponse {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) return NextResponse.next(); // not enforced unless configured

  const auth = req.headers.get("authorization");
  const cron = process.env.CRON_SECRET;
  const ok = auth === `Bearer ${apiToken}` || (!!cron && auth === `Bearer ${cron}`);
  if (ok) return NextResponse.next();

  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = { matcher: "/api/:path*" };
