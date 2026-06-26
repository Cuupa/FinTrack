// Server-side ETF/fund constituent fetcher. Used by /api/constituents/ensure
// (first global fetch when an asset is created) and /api/cron/sync-constituents
// (periodic refresh).
//
// Sources (in order):
//   - SlickCharts — full index constituents with weights, for the indices that
//     common ETFs track (S&P 500, Nasdaq-100, Dow). Keyless.
//   - iShares — the issuer's full holdings CSV (real, complete), by ISIN, for
//     the funds in ISHARES_CSV. Keyless. (Yahoo/justETF only expose top-10.)
//   - Financial Modeling Prep — any ETF's holdings, if FMP_API_KEY is set.
// Returns null when there's no source, so curated/seeded data is left untouched.

export interface ConstituentRow {
  name: string;
  symbol: string | null;
  isin: string | null;
  weight: number; // fraction of the fund (0..1)
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const TIMEOUT = 15_000;
const MAX = 60;

// ETF symbol → SlickCharts index slug.
const SLICKCHARTS_INDEX: Record<string, string> = {
  SPY: "sp500",
  VOO: "sp500",
  IVV: "sp500",
  SPLG: "sp500",
  QQQ: "nasdaq100",
  QQQM: "nasdaq100",
  DIA: "dowjones",
};

// ISIN → iShares full-holdings CSV download (issuer-published, complete).
// Add more funds by copying the "Detailed holdings" CSV link from the product
// page. These give the full holdings list with weights.
const ISHARES_CSV: Record<string, string> = {
  // iShares Core MSCI World UCITS ETF (Acc) — IWDA
  IE00B4L5Y983:
    "https://www.ishares.com/uk/individual/en/products/251882/ishares-msci-world-ucits-etf-acc-fund/1506575576011.ajax?fileType=csv&fileName=iShares-Core-MSCI-World-UCITS-ETF-USD-Acc_fund&dataType=fund",
};

function dedupe(rows: ConstituentRow[]): ConstituentRow[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.name)) r.name = `${r.name} (${r.symbol ?? ""})`.trim();
    seen.add(r.name);
  }
  return rows;
}

async function fetchSlickcharts(index: string): Promise<ConstituentRow[] | null> {
  try {
    const res = await fetch(`https://www.slickcharts.com/${index}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const rows: ConstituentRow[] = [];
    for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map((c) =>
        c.replace(/<[^>]+>/g, "").trim(),
      );
      if (cells.length < 4) continue;
      const name = cells[1];
      const symbol = cells[2];
      const m = cells[3].match(/([\d.]+)%/);
      if (!name || !symbol || !m) continue;
      rows.push({ name, symbol, isin: null, weight: Number(m[1]) / 100 });
      if (rows.length >= MAX) break;
    }
    return rows.length ? dedupe(rows) : null;
  } catch {
    return null;
  }
}

async function fetchIShares(url: string): Promise<ConstituentRow[] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    const csv = await res.text();
    const rows: ConstituentRow[] = [];
    for (const line of csv.split("\n")) {
      if (!line.startsWith('"')) continue; // skip header/preamble/disclaimer
      // Fields are quoted and comma-free at the "," boundary.
      const f = line.replace(/^"|"\s*$/g, "").split('","');
      if (f.length < 6) continue;
      const [ticker, name, , assetClass, , weightStr] = f;
      if (assetClass !== "Equity") continue;
      const weight = Number(weightStr.replace(/,/g, ""));
      if (!name || !Number.isFinite(weight) || weight <= 0) continue;
      rows.push({ name, symbol: ticker || null, isin: null, weight: weight / 100 });
    }
    rows.sort((a, b) => b.weight - a.weight);
    return rows.length ? dedupe(rows.slice(0, MAX)) : null;
  } catch {
    return null;
  }
}

async function fetchFMP(symbol: string): Promise<ConstituentRow[] | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/etf-holder/${encodeURIComponent(symbol)}?apikey=${key}`,
      { signal: AbortSignal.timeout(TIMEOUT) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      asset?: string;
      name?: string;
      isin?: string;
      weightPercentage?: number;
    }>;
    if (!Array.isArray(data)) return null;
    const rows = data
      .filter((h) => h.name && typeof h.weightPercentage === "number")
      .sort((a, b) => (b.weightPercentage ?? 0) - (a.weightPercentage ?? 0))
      .slice(0, MAX)
      .map((h) => ({
        name: h.name as string,
        symbol: h.asset ?? null,
        isin: h.isin ?? null,
        weight: Math.min(1, Math.max(0, (h.weightPercentage ?? 0) / 100)),
      }));
    return rows.length ? dedupe(rows) : null;
  } catch {
    return null;
  }
}

/** Fetch constituents for an ETF, or null if no source is available. */
export async function fetchConstituents(
  symbol: string,
  isin?: string | null,
): Promise<ConstituentRow[] | null> {
  const idx = SLICKCHARTS_INDEX[symbol.toUpperCase()];
  if (idx) return fetchSlickcharts(idx);
  const isharesUrl = isin ? ISHARES_CSV[isin.toUpperCase()] : undefined;
  if (isharesUrl) return fetchIShares(isharesUrl);
  return fetchFMP(symbol);
}
