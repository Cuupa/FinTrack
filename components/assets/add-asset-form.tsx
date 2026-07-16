"use client";

// Manual asset entry (PRD §3.1) with auto-import. The user enters a WKN, ISIN,
// or symbol; `lookupAsset` fills in name, ISIN/WKN and — crucially — detects
// the asset type automatically (e.g. "BTC" → CRYPTO, "A2PKXG" → ETF). Unknown
// identifiers fall back to manual entry. The opening transaction carries a
// full date+time.

import { useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { currentPrice } from "@/lib/finance/prices";
import { cashAssetInPortfolio } from "@/lib/finance/portfolio";
import { parseDecimal, stripLeadingZero } from "@/lib/format";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";
import { orderFee } from "@/lib/finance/fees";
import { fetchLivePrice } from "@/lib/live/fetch-price";
import { nowDateTimeLocal } from "@/lib/finance/dates";
import { isStorageFullError } from "@/lib/store/errors";
import { ASSET_TYPES, type AssetType } from "@/lib/types";
import { Button, Card } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFormTouched, missingFieldCls } from "@/lib/forms/required";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function AddAssetForm({
  onDone,
  embedded = false,
  initialQuery,
}: {
  onDone?: () => void;
  embedded?: boolean;
  /** Pre-fills the identifier field and runs the import flow once on mount
   * (e.g. when embedded from a non-held instrument's "Add to portfolio"). */
  initialQuery?: string;
}) {
  const { addAsset, addTransaction, createPortfolio, data, portfolios, selectedPortfolioIds } =
    usePortfolio();
  const { t: tr } = useI18n();
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [newPortfolio, setNewPortfolio] = useState("");
  const [addingPortfolio, setAddingPortfolio] = useState(false);
  const base = data.profile.currency;
  // A portfolio may hold only one cash position — once it has one, CASH is
  // disabled in the type picker and blocked at submit (re-checked there too,
  // since the portfolio can change mid-form).
  const cashTaken =
    !!portfolioId && !!cashAssetInPortfolio(data.assets, data.transactions, portfolioId);

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
  // null = not yet edited by the user: the fee input tracks the portfolio's
  // order-fee model (below) live. Once the user types into the field, the
  // manual value wins permanently for this form instance.
  const [feeManual, setFeeManual] = useState<string | null>(null);
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
    if (!query || t === "CASH" || t === "CRYPTO" || t === "COMMODITY") return; // crypto/commodity need a catalog id
    setFetchingPrice(true);
    try {
      const p = await fetchLivePrice(query, currency);
      if (p != null) setPrice(String(round(p)));
    } finally {
      setFetchingPrice(false);
    }
  }

  const isCash = type === "CASH";
  // A resolved import (or chosen manual type) reveals the rest of the form.
  const ready = importStatus === "found" || manual;

  const { touched, touch } = useFormTouched();
  // Presence-only gating for the "Add asset" submit button — mirrors the
  // checks in handleSubmit exactly (content validity still happens there).
  const quantityMissing = !quantity.trim();
  const priceMissing = !isCash && !price.trim();
  const identifierOrNameMissing =
    !isCash && manual && !name.trim() && !isin.trim() && !wkn.trim() && !symbol.trim();
  const formIncomplete = quantityMissing || priceMissing || identifierOrNameMissing;

  // The opening transaction is always a BUY — prefill its fee from the
  // chosen portfolio's order-fee model (volume = shares × price) unless the
  // user has already typed into the fee field.
  const selectedPortfolio = portfolios.find((p) => p.id === portfolioId);
  const qtyNum = parseDecimal(quantity);
  const pxNum = isCash ? 1 : parseDecimal(price);
  const volume = Number.isFinite(qtyNum) && Number.isFinite(pxNum) ? qtyNum * pxNum : 0;
  const autoFee = !isCash ? orderFee(selectedPortfolio, volume) : 0;
  const fee = feeManual ?? String(round(autoFee));

  async function importFor(q: string) {
    const query = q.trim();
    if (!query) return;
    setImporting(true);
    setError(null);
    try {
      // Local catalog first (DB), then the live lookup API (resolves any
      // ISIN/symbol via Yahoo) — shared with the watchlist and savings-plan
      // "add asset" flows.
      const m = await resolveInstrumentByQuery(query);
      if (m) {
        setName(m.name);
        setIsin(m.isin ?? "");
        setWkn(m.wkn ?? "");
        setSymbol(m.symbol ?? "");
        setType(m.type);
        // Default to the user's base currency; price is prefilled to match.
        setAssetCurrency(m.currency ?? base);
        if (m.type !== "CASH") setAssetCurrency(base);
        setImportStatus("found");
        setManual(false);
        void fetchPrice(m.isin || m.symbol || query, base, m.type);
      } else {
        setImportStatus("notfound");
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleImport() {
    await importFor(query);
  }

  // Prefill + auto-run the import flow once, when embedded with a known
  // identifier (e.g. "Add to portfolio" on a non-held instrument's detail
  // page). Guarded by a ref so it only ever fires once per mount, and the
  // state updates happen in an async continuation (after an await), not
  // synchronously in the effect body, per the set-state-in-effect rule.
  const initialQueryRan = useRef(false);
  useEffect(() => {
    if (!initialQuery || initialQueryRan.current) return;
    initialQueryRan.current = true;
    const run = async () => {
      await Promise.resolve();
      setQuery(initialQuery);
      await importFor(initialQuery);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  function selectType(next: AssetType) {
    setType(next);
    // Gold (XAU) is currently the only commodity the app can price, so prefill the
    // ISO gold code to make adding it one click. Non-destructive: only fills blank
    // fields, never overwrites what the user already typed. The authoritative name
    // and live price still come from the seeded catalog in production.
    if (next === "COMMODITY") {
      if (!symbol.trim()) setSymbol("XAU");
      if (!name.trim()) setName("Gold");
      if (!price.trim()) setPrice(String(round(currentPrice("XAU", "COMMODITY"))));
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
      setError(isCash ? tr("addAsset.errAmount") : tr("addAsset.errQuantity"));
      return;
    }
    if (!isCash && (!Number.isFinite(px) || px < 0)) {
      setError(tr("addAsset.errPrice"));
      return;
    }
    const hasIdentifier = isin.trim() || wkn.trim() || symbol.trim();
    if (!isCash && !hasIdentifier && !name.trim()) {
      setError(tr("addAsset.errIdentifier"));
      return;
    }
    // Re-check on submit: the portfolio (and its cash position) can have
    // changed since the type was picked.
    if (isCash && cashAssetInPortfolio(data.assets, data.transactions, portfolioId)) {
      setError(tr("addAsset.cashExists"));
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
        tax: 0,
        date: executedAt,
      });
      // Constituents are populated server-side by the sync-constituents cron
      // (the ensure endpoint is now secret-gated), so nothing to trigger here.
      onDone?.();
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? tr("common.storageFull")
          : err instanceof Error
            ? err.message
            : tr("addAsset.errFailed"),
      );
      setBusy(false);
    }
  }

  const body = (
    <>
      {!embedded && <h2 className="text-lg font-semibold">{tr("addAsset.title")}</h2>}

      {/* Import field */}
      {!manual && (
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor="import">
            {tr("addAsset.identifierLabel")}
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
              onBlur={(e) => {
                if (
                  (e.relatedTarget as HTMLElement | null)?.id !== "import-submit" &&
                  query.trim() &&
                  importStatus !== "found" &&
                  !importing
                ) {
                  void handleImport();
                }
              }}
              placeholder={tr("addAsset.identifierPlaceholder")}
              className={inputCls}
              autoFocus
            />
            <Button
              id="import-submit"
              type="button"
              variant="primary"
              className="mt-1 shrink-0"
              onClick={handleImport}
              disabled={importing || !query.trim()}
            >
              {importing ? "…" : tr("addAsset.importBtn")}
            </Button>
          </div>
          {importStatus === "notfound" && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              {/^[A-Z0-9]{6}$/.test(query.trim()) && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(query.trim())
                ? tr("addAsset.notFoundWkn")
                : tr("addAsset.notFound")}
              <button
                type="button"
                onClick={startManual}
                className="font-medium underline underline-offset-2"
              >
                {tr("addAsset.enterManually")}
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
              {tr("addAsset.orManual")}
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
            {wkn && <>{tr("addAsset.wkn")} {wkn}</>}
            {wkn && isin && " · "}
            {isin && <>{tr("addAsset.isin")} {isin}</>}
            {symbol && !isin && !wkn && <>{tr("addAsset.symbol")} {symbol}</>}
            {!isCash && <> · {assetCurrency}</>}
          </div>
        </div>
      )}

      {/* Manual master-data entry */}
      {manual && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium">{tr("addAsset.type")}</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {ASSET_TYPES.map((t) => {
                const disabled = t === "CASH" && cashTaken;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => !disabled && selectType(t)}
                    disabled={disabled}
                    title={disabled ? tr("addAsset.cashExists") : undefined}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      type === t
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                        : disabled
                          ? "cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-zinc-800 dark:text-zinc-600"
                          : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {tr(`assetType.${t}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="name">
              {tr("addAsset.name")}
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => {
                touch();
                setName(e.target.value);
              }}
              onBlur={touch}
              placeholder={isCash ? tr("addAsset.namePlaceholderCash") : tr("addAsset.namePlaceholder")}
              className={`${inputCls}${missingFieldCls(identifierOrNameMissing, touched)}`}
            />
          </div>

          {!isCash &&
            (type === "CRYPTO" || type === "COMMODITY" ? (
              <div>
                <label className="text-sm font-medium" htmlFor="symbol">
                  {tr("addAsset.symbol")}
                </label>
                <input
                  id="symbol"
                  value={symbol}
                  onChange={(e) => {
                    touch();
                    setSymbol(e.target.value.toUpperCase());
                  }}
                  onBlur={touch}
                  placeholder={tr("addAsset.symbolPlaceholder")}
                  className={`${inputCls}${missingFieldCls(identifierOrNameMissing, touched)}`}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium" htmlFor="isin">
                    {tr("addAsset.isin")}
                  </label>
                  <input
                    id="isin"
                    value={isin}
                    onChange={(e) => {
                      touch();
                      setIsin(e.target.value.toUpperCase());
                    }}
                    onBlur={touch}
                    className={`${inputCls}${missingFieldCls(identifierOrNameMissing, touched)}`}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor="wkn">
                    {tr("addAsset.wkn")}
                  </label>
                  <input
                    id="wkn"
                    value={wkn}
                    onChange={(e) => {
                      touch();
                      setWkn(e.target.value.toUpperCase());
                    }}
                    onBlur={touch}
                    className={`${inputCls}${missingFieldCls(identifierOrNameMissing, touched)}`}
                  />
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Trading currency — drives which listing the price comes from. */}
      {ready && !isCash && (
        <div className="mt-4">
          <label className="text-sm font-medium">{tr("addAsset.tradingCurrency")}</label>
          <div className="mt-1 max-w-[10rem]">
            <SelectMenu
              value={assetCurrency}
              ariaLabel={tr("addAsset.tradingCurrency")}
              onChange={(c) => {
                setAssetCurrency(c);
                void fetchPrice(isin || symbol, c, type);
              }}
              options={Array.from(new Set([base, ...CURRENCIES])).map((c) => ({
                value: c,
                label: c,
              }))}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {tr("addAsset.tradingCurrencyHint", { base })}
          </p>
        </div>
      )}

      {/* Opening transaction */}
      {ready && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">{tr("addAsset.openingTx")}</h3>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="text-sm font-medium" htmlFor="quantity">
                {isCash ? tr("addAsset.amount") : tr("addAsset.quantity")}
              </label>
              <input
                id="quantity"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  touch();
                  setQuantity(stripLeadingZero(e.target.value));
                }}
                onBlur={touch}
                className={`${inputCls}${missingFieldCls(quantityMissing, touched)}`}
              />
            </div>
            {!isCash && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium" htmlFor="price">
                    {tr("addAsset.price", { currency: assetCurrency })}
                  </label>
                  {(type === "STOCK" || type === "ETF") && (isin || symbol) && (
                    <button
                      type="button"
                      onClick={() => void fetchPrice(isin || symbol, assetCurrency, type)}
                      disabled={fetchingPrice}
                      className="text-xs text-zinc-500 underline underline-offset-2 disabled:opacity-50"
                    >
                      {fetchingPrice ? "…" : tr("addAsset.live")}
                    </button>
                  )}
                </div>
                <input
                  id="price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    touch();
                    setPrice(stripLeadingZero(e.target.value));
                  }}
                  onBlur={touch}
                  className={`${inputCls}${missingFieldCls(priceMissing, touched)}`}
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium" htmlFor="fee">
                {tr("addAsset.fee")}
              </label>
              <input
                id="fee"
                type="text"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFeeManual(stripLeadingZero(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="date">
                {tr("addAsset.dateTime")}
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
            <div>
              <label className="text-sm font-medium">{tr("addAsset.portfolio")}</label>
              <div className="mt-1">
                <SelectMenu
                  value={portfolioId}
                  ariaLabel={tr("addAsset.portfolio")}
                  onChange={setPortfolioId}
                  options={portfolios.map((p) => ({ value: p.id, label: p.name }))}
                  footer={(close) =>
                    addingPortfolio ? (
                      <input
                        autoFocus
                        value={newPortfolio}
                        placeholder={tr("addAsset.portfolioNamePlaceholder")}
                        onChange={(e) => setNewPortfolio(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            const name = newPortfolio.trim();
                            if (name) {
                              try {
                                const p = await createPortfolio(name);
                                setPortfolioId(p.id);
                              } catch {
                                /* at max portfolios — ignore */
                              }
                            }
                            setNewPortfolio("");
                            setAddingPortfolio(false);
                            close();
                          }
                          if (e.key === "Escape") {
                            setAddingPortfolio(false);
                            setNewPortfolio("");
                          }
                        }}
                        className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingPortfolio(true)}
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                      >
                        {tr("nav.newPortfolio")}
                      </button>
                    )
                  }
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {formIncomplete && touched && (
            <p className="text-xs text-zinc-500">{tr("form.missingFields")}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy || formIncomplete}>
              {busy ? tr("addAsset.adding") : tr("addAsset.title")}
            </Button>
            {onDone && (
              <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
                {tr("tx.cancel")}
              </Button>
            )}
          </div>
        </form>
      )}

      {!ready && onDone && (
        <div className="mt-4">
          <Button type="button" variant="ghost" onClick={onDone}>
            {tr("tx.cancel")}
          </Button>
        </div>
      )}
    </>
  );

  return embedded ? body : <Card>{body}</Card>;
}
