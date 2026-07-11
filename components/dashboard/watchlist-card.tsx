"use client";

// Dashboard watchlist: instruments the user follows without holding them.
// Prices come from the catalog cache (populated by the price-sync cron), with
// the same one-shot /api/price fallback the live-prices provider uses for
// uncached equities. Gated by the `watchlist` feature flag — renders nothing
// when disabled.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { lookupInstrument } from "@/lib/catalog/catalog";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { resolveInstrumentByQuery } from "@/lib/import/resolve-instrument";
import { assetIdentifier, assetPriceKey, type WatchlistItem } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { Button, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import { pickWatchlistPrice } from "@/lib/live/watchlist-price";
import { isStorageFullError } from "@/lib/store/errors";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

export function WatchlistCard() {
  const enabled = useFeatureFlag("watchlist");
  const { data, addWatchlistItem, removeWatchlistItem } = usePortfolio();
  const { version } = useCatalog();
  const { t } = useI18n();
  const base = data.profile.currency;

  const [query, setQuery] = useState("");
  const [addCurrency, setAddCurrency] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WatchlistItem | null>(null);
  // One-shot /api/price results for items the cron hasn't cached, keyed by
  // price key, in the item's own currency (mirrors LivePricesProvider).
  const [fetched, setFetched] = useState<Record<string, number>>({});

  const watchlist = data.watchlist;

  // Price per item: the item's own currency override beats the cron-cached
  // catalog price when they disagree (see lib/live/watchlist-price.ts - this
  // is the GME 2.23-instead-of-22 fix), otherwise falls back to the one-shot
  // fetch in the display currency.
  const priced = useMemo(
    () =>
      watchlist.map((item) => {
        const key = assetPriceKey(item);
        const inst = lookupInstrument(key);
        const { price, currency, wantsFetch } = pickWatchlistPrice(item, inst, fetched[key], base);
        return { item, key, price, currency, wantsFetch };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchlist, base, version, fetched],
  );

  // Fetch prices for uncached equities, one shot per item (not polled).
  const uncachedSig = priced
    .filter((p) => p.wantsFetch && (p.item.type === "STOCK" || p.item.type === "ETF"))
    .map((p) => p.key)
    .join(",");
  useEffect(() => {
    if (!uncachedSig) return;
    let cancelled = false;
    const targets = priced.filter(
      (p) => p.wantsFetch && (p.item.type === "STOCK" || p.item.type === "ETF"),
    );
    const run = async () => {
      const results = await Promise.all(
        targets.map(async ({ item, key, currency }) => {
          const q = item.isin || item.symbol;
          if (!q) return null;
          try {
            const res = await fetch(
              `/api/price?q=${encodeURIComponent(q)}&currency=${encodeURIComponent(
                currency,
              )}&name=${encodeURIComponent(item.name)}`,
            );
            if (!res.ok) return null;
            const d = (await res.json()) as { found?: boolean; price?: number };
            if (d.found && typeof d.price === "number" && d.price > 0) {
              return [key, d.price] as const;
            }
          } catch {
            /* no price — row shows "—" */
          }
          return null;
        }),
      );
      if (cancelled) return;
      const add: Record<string, number> = {};
      for (const r of results) if (r) add[r[0]] = r[1];
      if (Object.keys(add).length > 0) setFetched((prev) => ({ ...prev, ...add }));
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uncachedSig]);

  if (!enabled) return null;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      const m = await resolveInstrumentByQuery(q);
      if (!m) {
        setError(t("watchlist.notFound"));
        return;
      }
      const currency = addCurrency === "auto" ? m.currency : addCurrency;
      const input: Omit<WatchlistItem, "id"> = { ...m, currency };
      const key = assetPriceKey(input);
      if (watchlist.some((w) => assetPriceKey(w) === key)) {
        setError(t("watchlist.exists"));
        return;
      }
      await addWatchlistItem(input);
      setQuery("");
      setAddCurrency("auto");
    } catch (err) {
      setError(
        isStorageFullError(err)
          ? t("common.storageFull")
          : err instanceof Error
            ? err.message
            : t("watchlist.notFound"),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleRemove(item: WatchlistItem) {
    setError(null);
    removeWatchlistItem(item.id).catch((err: unknown) => {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("watchlist.removeError"));
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("watchlist.title")}</h2>
        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("watchlist.placeholder")}
            aria-label={t("watchlist.placeholder")}
            className="w-44 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 md:w-56 dark:border-zinc-700"
          />
          <SelectMenu
            value={addCurrency}
            ariaLabel={t("watchlist.currency")}
            onChange={setAddCurrency}
            options={[
              { value: "auto", label: t("watchlist.currencyAuto") },
              ...Array.from(new Set([base, ...CURRENCIES])).map((c) => ({ value: c, label: c })),
            ]}
            className="w-24"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !query.trim()}>
            {busy ? "…" : t("watchlist.add")}
          </Button>
        </form>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {watchlist.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("watchlist.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {priced.map(({ item, price, currency }) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <Link
                href={`/instruments/${encodeURIComponent(assetPriceKey(item))}`}
                title={t("watchlist.viewDetails")}
                className="min-w-0 hover:underline"
              >
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block truncate font-mono text-xs text-zinc-500">
                  {assetIdentifier(item)}
                </span>
              </Link>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm tabular-nums">
                  {price != null ? (
                    formatCurrency(price, currency)
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setRemoving(item)}
                  className="px-1 text-zinc-400 hover:text-red-500"
                  aria-label={t("watchlist.removeTitle")}
                  title={t("watchlist.removeTitle")}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t("watchlist.removeTitle")}
        message={removing ? t("watchlist.removeMsg", { name: removing.name }) : undefined}
        confirmLabel={t("watchlist.removeConfirm")}
        onConfirm={() => {
          if (removing) handleRemove(removing);
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
