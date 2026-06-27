"use client";

// Add a buy/sell event to an existing asset (PRD §3.1 transaction history).

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { nowDateTimeLocal } from "@/lib/finance/dates";
import { currentPrice } from "@/lib/finance/prices";
import { assetPriceKey, type Asset, type TransactionType } from "@/lib/types";
import { Button } from "@/components/ui/primitives";

const inputCls =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function TransactionForm({
  asset,
  onDone,
}: {
  asset: Asset;
  onDone?: () => void;
}) {
  const { addTransaction } = usePortfolio();
  const isCash = asset.type === "CASH";

  const [type, setType] = useState<TransactionType>("BUY");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(
    isCash ? "1" : String(round(currentPrice(assetPriceKey(asset), asset.type))),
  );
  const [fee, setFee] = useState("0");
  const [executedAt, setExecutedAt] = useState(nowDateTimeLocal());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(quantity);
    const px = isCash ? 1 : Number(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Enter a positive quantity.");
      return;
    }
    setBusy(true);
    try {
      await addTransaction({
        assetId: asset.id,
        type,
        quantity: qty,
        price: px,
        fee: Number(fee) || 0,
        date: executedAt,
      });
      setQuantity("");
      setFee("0");
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add transaction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        {(["BUY", "SELL"] as TransactionType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              type === t
                ? t === "BUY"
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-red-500 bg-red-500 text-white"
                : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">{isCash ? "Amount" : "Quantity"}</label>
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputCls}
          />
        </div>
        {!isCash && (
          <div>
            <label className="text-sm font-medium">Price ({asset.currency})</label>
            <input
              type="number"
              step="any"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label className="text-sm font-medium">Fee</label>
          <input
            type="number"
            step="any"
            min="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium">Date &amp; time</label>
          <input
            type="datetime-local"
            value={executedAt}
            max={nowDateTimeLocal()}
            onChange={(e) => setExecutedAt(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? "Adding…" : `Add ${type.toLowerCase()}`}
      </Button>
    </form>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
