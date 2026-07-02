"use client";

// Manual asset entry (PRD §3.1) with auto-import. The user enters a WKN, ISIN,
// or symbol; `lookupAsset` fills in name, ISIN/WKN and — crucially — detects
// the asset type automatically (e.g. "BTC" → CRYPTO, "A2PKXG" → ETF). Unknown
// identifiers fall back to manual entry. The opening transaction carries a
// full date+time.

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { lookupInstrumentByQuery, currentPrice } from "@/lib/finance/prices";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import type { Instrument } from "@/lib/catalog/catalog";
import { nowDateTimeLocal } from "@/lib/finance/dates";
import { ASSET_TYPES, type AssetType } from "@/lib/types";
import { Button, Card } from "@/components/ui/primitives";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

function keyOf(a: { isin: string | null; wkn: string | null; symbol: string | null; name: string }) {
  return (a.isin || a.wkn || a.symbol || a.name || "").toUpperCase();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function AddAssetForm({
  onDone,
  embedded = false,
}: {
  onDone?: () => void;
  embedded?: boolean;
}) {
  const { addAsset, addTransaction, data, portfolios, selectedPortfolioIds } = usePortfolio();
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const base = data.profile.currency;

  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<"found" | "notfound" | null>(null);

  // Resolved/entered master data.
  const [name, setName] = useState("");
  const [isin, setIsin] = useState("");
  const [wkn, setWkn] = useState("");
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState<AssetType>("ETF");
  const [assetCurrency, setAssetCurrency] = useState(base);

  // Opening transaction.
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [executedAt, setExecutedAt] = useState(nowDateTimeLocal());

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);

  /**
   * Prefill the opening price in the user's chosen `currency` (the API converts
   * if only a different-currency listing exists). The chosen currency is the
   * holding's currency and is never overridden here — a US stock bought on a EUR
   * exchange stays EUR at the EUR price.
   */
  async function fetchPrice(q: string, currency: string, t: AssetType) {
    const query = q.trim();
    if (!query || t === "CASH" || t === "CRYPTO") return; // crypto needs a catalog id
    setFetchingPrice(true);
    try {
      const res = await fetch(
        `/api/price?q=${encodeURIComponent(query)}&currency=${encodeURIComponent(currency)}`,
      );
      if (res.ok) {
        const d = (await res.json()) as { found?: boolean; price?: number };
        if (d.found && typeof d.price === "number" && d.price > 0) {
          setPrice(String(round(d.price)));
        }
      }
    } catch {
      /* ignore — the user can type the price */
    } finally {
      setFetchingPrice(false);
    }
  }

  const isCash = type === "CASH";
  // A resolved import (or chosen manual type) reveals the rest of the form.
  const ready = importStatus === "found" || manual;

  function applyMatch(match: Instrument) {
    setName(match.name);
    setIsin(match.isin ?? "");
    setWkn(match.wkn ?? "");
    setSymbol(match.symbol ?? "");
    setType(match.type);
    setAssetCurrency(match.currency ?? base);
    setPrice(String(round(currentPrice(keyOf(match), match.type))));
  }

  interface ApiMatch {
    found: boolean;
    name?: string;
    symbol?: string | null;
    type?: AssetType;
    currency?: string | null;
    isin?: string | null;
  }

  function applyApiMatch(d: ApiMatch) {
    setName(d.name ?? "");
    setIsin(d.isin ?? "");
    setSymbol(d.symbol ?? "");
    setType(d.type ?? "ETF");
    setAssetCurrency(d.currency ?? base);
  }

  async function handleImport() {
    const q = query.trim();
    if (!q) return;
    setImporting(true);
    setError(null);
    try {
      // 1. Local catalog (DB).
      const match = lookupInstrumentByQuery(q);
      if (match) {
        applyMatch(match);
        setImportStatus("found");
        setManual(false);
        // Default to the user's base currency; price is prefilled to match.
        if (match.type !== "CASH") setAssetCurrency(base);
        void fetchPrice(match.isin || match.symbol || q, base, match.type);
        return;
      }
      // 2. Live lookup API (resolves any ISIN/symbol via Yahoo).
      const res = await apiFetch(`/api/lookup?q=${encodeURIComponent(q)}`);
      const data = (res.ok ? await res.json() : { found: false }) as ApiMatch;
      if (data.found) {
        applyApiMatch(data);
        setImportStatus("found");
        setManual(false);
        if ((data.type ?? "ETF") !== "CASH") setAssetCurrency(base);
        void fetchPrice(data.isin || data.symbol || q, base, data.type ?? "ETF");
      } else {
        setImportStatus("notfound");
      }
    } finally {
      setImporting(false);
    }
  }

  function startManual() {
    setManual(true);
    setImportStatus(null);
    // Seed identifier from whatever was typed.
    const q = query.trim().toUpperCase();
    if (q && !isin && !wkn && !symbol) {
      if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(q)) setIsin(q);
      else if (/^[A-Z0-9]{6}$/.test(q)) setWkn(q);
      else setSymbol(q);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const qty = parseDecimal(quantity);
    const px = isCash ? 1 : parseDecimal(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(isCash ? "Enter a positive amount." : "Enter a positive quantity.");
      return;
    }
    if (!isCash && (!Number.isFinite(px) || px < 0)) {
      setError("Enter a valid price.");
      return;
    }
    const hasIdentifier = isin.trim() || wkn.trim() || symbol.trim();
    if (!isCash && !hasIdentifier && !name.trim()) {
      setError("Enter an ISIN, WKN, or symbol.");
      return;
    }

    setBusy(true);
    try {
      const asset = await addAsset({
        isin: isin.trim() || null,
        wkn: wkn.trim() || null,
        symbol: symbol.trim().toUpperCase() || null,
        name: name.trim() || (isCash ? "Cash" : symbol.trim().toUpperCase() || "Asset"),
        type,
        currency: isCash ? base : assetCurrency || base,
        notes: null,
      });
      await addTransaction({
        assetId: asset.id,
        portfolioId: portfolioId || portfolios[0]?.id || "",
        type: "BUY",
        quantity: qty,
        price: px,
        fee: parseDecimal(fee) || 0,
        date: executedAt,
      });
      // Constituents are populated server-side by the sync-constituents cron
      // (the ensure endpoint is now secret-gated), so nothing to trigger here.
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add asset.");
      setBusy(false);
    }
  }

  const body = (
    <>
      {!embedded && <h2 className="text-lg font-semibold">Add asset</h2>}

      {/* Import field */}
      {!manual && (
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor="import">
            WKN / ISIN / Symbol
          </label>
          <div className="flex gap-2">
            <input
              id="import"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.toUpperCase());
                setImportStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleImport();
                }
              }}
              placeholder="A2PKXG, IE00BK5BQT80, BTC…"
              className={inputCls}
              autoFocus
            />
            <Button
              type="button"
              variant="primary"
              className="mt-1 shrink-0"
              onClick={handleImport}
              disabled={importing || !query.trim()}
            >
              {importing ? "…" : "Import"}
            </Button>
          </div>
          {importStatus === "notfound" && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              {/^[A-Z0-9]{6}$/.test(query.trim()) && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(query.trim())
                ? "Not found. WKN lookup isn’t supported by the data source — try the ISIN instead, or "
                : "Not found. "}
              <button
                type="button"
                onClick={startManual}
                className="font-medium underline underline-offset-2"
              >
                enter details manually
              </button>
              .
            </p>
          )}
          {importStatus !== "found" && (
            <button
              type="button"
              onClick={startManual}
              className="mt-2 text-xs text-zinc-500 underline underline-offset-2"
            >
              Or enter an asset manually (incl. cash)
            </button>
          )}
        </div>
      )}

      {/* Detected summary (auto-imported) */}
      {importStatus === "found" && !manual && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <div className="flex items-center justify-between">
            <span className="font-medium">{name}</span>
            <span className="rounded-full border border-emerald-400 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
              {type}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {wkn && <>WKN {wkn}</>}
            {wkn && isin && " · "}
            {isin && <>ISIN {isin}</>}
            {symbol && !isin && !wkn && <>Symbol {symbol}</>}
            {!isCash && <> · {assetCurrency}</>}
          </div>
        </div>
      )}

      {/* Manual master-data entry */}
      {manual && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium">Type</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {ASSET_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    type === t
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCash ? "Cash, Savings…" : "Apple Inc."}
              className={inputCls}
            />
          </div>

          {!isCash &&
            (type === "CRYPTO" ? (
              <div>
                <label className="text-sm font-medium" htmlFor="symbol">
                  Symbol
                </label>
                <input
                  id="symbol"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="BTC"
                  className={inputCls}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium" htmlFor="isin">
                    ISIN
                  </label>
                  <input
                    id="isin"
                    value={isin}
                    onChange={(e) => setIsin(e.target.value.toUpperCase())}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor="wkn">
                    WKN
                  </label>
                  <input
                    id="wkn"
                    value={wkn}
                    onChange={(e) => setWkn(e.target.value.toUpperCase())}
                    className={inputCls}
                  />
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Trading currency — drives which listing the price comes from. */}
      {ready && !isCash && (
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor="currency">
            Trading currency
          </label>
          <select
            id="currency"
            value={assetCurrency}
            onChange={(e) => {
              const c = e.target.value;
              setAssetCurrency(c);
              void fetchPrice(isin || symbol, c, type);
            }}
            className={inputCls}
          >
            {Array.from(new Set([base, ...CURRENCIES])).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            Prices use the listing in this currency — pick {base} if you trade on
            your home exchange.
          </p>
        </div>
      )}

      {/* Opening transaction */}
      {ready && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">Opening transaction</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="text-sm font-medium" htmlFor="quantity">
                {isCash ? "Amount" : "Quantity"}
              </label>
              <input
                id="quantity"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(stripLeadingZero(e.target.value))}
                className={inputCls}
              />
            </div>
            {!isCash && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium" htmlFor="price">
                    Price ({assetCurrency})
                  </label>
                  {(type === "STOCK" || type === "ETF") && (isin || symbol) && (
                    <button
                      type="button"
                      onClick={() => void fetchPrice(isin || symbol, assetCurrency, type)}
                      disabled={fetchingPrice}
                      className="text-xs text-zinc-500 underline underline-offset-2 disabled:opacity-50"
                    >
                      {fetchingPrice ? "…" : "↻ live"}
                    </button>
                  )}
                </div>
                <input
                  id="price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(stripLeadingZero(e.target.value))}
                  className={inputCls}
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium" htmlFor="fee">
                Fee
              </label>
              <input
                id="fee"
                type="text"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(stripLeadingZero(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="date">
                Date &amp; time
              </label>
              <input
                id="date"
                type="datetime-local"
                value={executedAt}
                max={nowDateTimeLocal()}
                onChange={(e) => setExecutedAt(e.target.value)}
                className={inputCls}
              />
            </div>
            {portfolios.length > 1 && (
              <div>
                <label className="text-sm font-medium" htmlFor="portfolio">
                  Portfolio
                </label>
                <select
                  id="portfolio"
                  value={portfolioId}
                  onChange={(e) => setPortfolioId(e.target.value)}
                  className={inputCls}
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Adding…" : "Add asset"}
            </Button>
            {onDone && (
              <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {!ready && onDone && (
        <div className="mt-4">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      )}
    </>
  );

  return embedded ? body : <Card>{body}</Card>;
}
