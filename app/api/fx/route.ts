// FX rates → base currency, via Frankfurter (ECB, keyless). Given a base and a
// list of source currencies, returns `{ [currency]: rateToBase }` so the
// client can convert native-currency prices into the base currency.
//
// Frankfurter quotes base→target; we request base→sources in one call and
// invert each rate to get source→base. Missing/failed currencies are omitted
// (the client treats them as rate 1).

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!(await rateLimit("fx", req, 120))) return tooManyRequests();
  const url = new URL(req.url);
  const base = (url.searchParams.get("base") || "EUR").toUpperCase();
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s && s !== base);

  const rates: Record<string, number> = {};
  if (symbols.length === 0) return Response.json({ rates });

  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?from=${base}&to=${symbols.join(",")}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      for (const [cur, baseToCur] of Object.entries(data.rates ?? {})) {
        if (typeof baseToCur === "number" && baseToCur > 0) {
          rates[cur] = 1 / baseToCur; // source → base
        }
      }
    }
  } catch {
    // network/provider failure → empty rates, client falls back to 1:1
  }

  return Response.json({ rates });
}
