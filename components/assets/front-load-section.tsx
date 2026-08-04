"use client";

// Ausgabeaufschlag of an actively managed fund: the surcharge on top of a
// unit's net asset value that you pay to buy it. Stored on the user's own asset
// row rather than the shared instruments catalog — what you pay is a property
// of your purchase route, and one user's discounted fund must never rewrite
// everybody else's reference data.
//
// The maths lives in lib/finance/front-load.ts; this component only edits the
// rate through the store seam and shows what it costs on a sample order, so the
// number is something the user can check rather than trust.

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { frontLoadSplit } from "@/lib/finance/front-load";
import type { Asset } from "@/lib/types";
import { formatCurrency, formatNumber, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { FormActions } from "@/components/ui/form-actions";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";

const inputCls =
  "mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

/** What the worked example below invests, so the cost is a concrete figure. */
const SAMPLE_ORDER = 1000;
/** and the NAV it is priced off, so the percentage reads as money without
 *  needing a live quote. */
const SAMPLE_NAV = 100;

export function FrontLoadSection({ asset }: { asset: Asset }) {
  const { data, updateAsset } = usePortfolio();
  const { t } = useI18n();
  const cur = asset.currency || data.profile.currency;

  const [rate, setRate] = useState(asset.frontLoad != null ? String(asset.frontLoad) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseDecimal(rate);
  const blank = rate.trim() === "";
  const invalid = !blank && (!Number.isFinite(parsed) || parsed < 0);
  const next = blank || parsed <= 0 ? null : parsed;
  const dirty = next !== (asset.frontLoad ?? null);

  const sample = frontLoadSplit(SAMPLE_ORDER, SAMPLE_NAV, next ?? 0);

  async function save() {
    if (invalid) {
      setError(t("asset.frontLoad.error"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateAsset(asset.id, { frontLoad: next });
      setSaved(true);
    } catch (err) {
      setError(isStorageFullError(err) ? t("common.storageFull") : t("asset.frontLoad.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-y border-zinc-200 py-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">{t("asset.frontLoad.title")}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">{t("asset.frontLoad.intro")}</p>
        </div>
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-400">
          {t("asset.frontLoad.rate")}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(0,1.3fr)]">
        <label className="block max-w-sm">
          <span className="text-sm font-medium">{t("asset.frontLoad.rate")}</span>
          <div className="relative mt-1">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={rate}
              onChange={(e) => {
                setSaved(false);
                setRate(stripLeadingZero(e.target.value));
              }}
              className={`${inputCls} pr-10 text-right tabular-nums`}
              aria-label={t("asset.frontLoad.rate")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-zinc-400">
              %
            </span>
          </div>
        </label>

        <div className="rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {t("asset.frontLoad.sampleLabel", { amount: formatCurrency(SAMPLE_ORDER, cur) })}
          </p>
          {next ? (
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-zinc-500">{t("asset.frontLoad.sampleCharge")}</p>
                <p className="mt-1 font-semibold tabular-nums">{formatCurrency(sample.charge, cur)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">{t("asset.frontLoad.sampleUnits")}</p>
                <p className="mt-1 font-semibold tabular-nums">{formatNumber(sample.quantity, 3)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">{t("asset.frontLoad.sampleOffer")}</p>
                <p className="mt-1 font-semibold tabular-nums">{formatCurrency(sample.offerPrice, cur)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">{t("asset.frontLoad.sampleNone")}</p>
          )}
        </div>
      </div>
      <FormActions error={error}>
        {saved && !dirty && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            {t("asset.frontLoad.saved")}
          </span>
        )}
        <Button size="sm" variant="primary" disabled={saving || !dirty || invalid} onClick={save}>
          {saving ? t("asset.frontLoad.saving") : t("asset.frontLoad.save")}
        </Button>
      </FormActions>
    </section>
  );
}
