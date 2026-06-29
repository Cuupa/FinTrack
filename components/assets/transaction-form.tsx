"use client";

// Add a buy/sell event to an existing asset (PRD §3.1 transaction history).

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { nowDateTimeLocal } from "@/lib/finance/dates";
import { currentPrice } from "@/lib/finance/prices";
import { formatCurrency, parseDecimal, stripLeadingZero } from "@/lib/format";
import { assetPriceKey, type Asset, type TransactionType } from "@/lib/types";
import { Button } from "@/components/ui/primitives";

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function TransactionForm({
  asset,
  onDone,
}: {
  asset: Asset;
  onDone?: () => void;
}) {
  const { addTransaction, portfolios, selectedPortfolioIds } = usePortfolio();
  const isCash = asset.type === "CASH";
  const cur = asset.currency || "EUR";

  const [type, setType] = useState<TransactionType>("BUY");
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(
    isCash ? "1" : String(round(currentPrice(assetPriceKey(asset), asset.type))),
  );
  const [fee, setFee] = useState("0");
  const [executedAt, setExecutedAt] = useState(nowDateTimeLocal());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isBuy = type === "BUY";
  const qtyNum = parseDecimal(quantity);
  const pxNum = isCash ? 1 : parseDecimal(price);
  const feeNum = parseDecimal(fee) || 0;
  // Cash leaving (buy) / arriving (sell) once fees are applied.
  const gross = Number.isFinite(qtyNum) && Number.isFinite(pxNum) ? qtyNum * pxNum : 0;
  const total = isBuy ? gross + feeNum : gross - feeNum;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = parseDecimal(quantity);
    const px = isCash ? 1 : parseDecimal(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Enter a positive quantity.");
      return;
    }
    if (!isCash && (!Number.isFinite(px) || px < 0)) {
      setError("Enter a valid price.");
      return;
    }
    setBusy(true);
    try {
      await addTransaction({
        assetId: asset.id,
        portfolioId: portfolioId || portfolios[0]?.id || "",
        type,
        quantity: qty,
        price: px,
        fee: parseDecimal(fee) || 0,
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Buy / Sell segmented toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/60">
        {(["BUY", "SELL"] as TransactionType[]).map((tt) => {
          const active = type === tt;
          return (
            <button
              key={tt}
              type="button"
              onClick={() => setType(tt)}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                active
                  ? tt === "BUY"
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "bg-red-500 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {tt === "BUY" ? "Buy" : "Sell"}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={isCash ? "Amount" : "Quantity"}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={quantity}
            onChange={(e) => setQuantity(stripLeadingZero(e.target.value))}
            className={inputCls}
          />
        </Field>
        {!isCash && (
          <Field label="Price">
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(stripLeadingZero(e.target.value))}
                className={`${inputCls} pr-12`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
                {cur}
              </span>
            </div>
          </Field>
        )}
        <Field label="Fee">
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(stripLeadingZero(e.target.value))}
              className={`${inputCls} pr-12`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              {cur}
            </span>
          </div>
        </Field>
        <Field label="Date & time">
          <input
            type="datetime-local"
            value={executedAt}
            max={nowDateTimeLocal()}
            onChange={(e) => setExecutedAt(e.target.value)}
            className={inputCls}
          />
        </Field>
        {portfolios.length > 1 && (
          <Field label="Portfolio" className="col-span-2">
            <select
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
          </Field>
        )}
      </div>

      {/* Live total preview */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/40">
        <span className="text-zinc-500">{isBuy ? "Total cost" : "Total proceeds"}</span>
        <span
          className={`font-semibold tabular-nums ${
            isBuy ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {isBuy ? "−" : "+"}
          {formatCurrency(Math.max(0, total), cur)}
        </span>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        disabled={busy}
        className={`w-full ${
          isBuy
            ? "!bg-emerald-500 hover:!bg-emerald-600 !text-white dark:!bg-emerald-500"
            : "!bg-red-500 hover:!bg-red-600 !text-white dark:!bg-red-500"
        }`}
      >
        {busy ? "Adding…" : isBuy ? "Add buy" : "Add sell"}
      </Button>
    </form>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
