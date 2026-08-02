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
import { Button, Card } from "@/components/ui/primitives";
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
    <Card>
      <h2 className="text-lg font-semibold">{t("asset.frontLoad.title")}</h2>
      <p className="mt-1 text-sm text-zinc-500">{t("asset.frontLoad.intro")}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">{t("asset.frontLoad.rate")}</span>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={rate}
              onChange={(e) => {
                setSaved(false);
                setRate(stripLeadingZero(e.target.value));
              }}
              className={`${inputCls} pr-8`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-400">
              %
            </span>
          </div>
        </label>
        <div className="text-sm">
          <span className="text-xs font-medium text-zinc-500">
            {t("asset.frontLoad.sampleLabel", { amount: formatCurrency(SAMPLE_ORDER, cur) })}
          </span>
          <p className="mt-1 tabular-nums">
            {next
              ? t("asset.frontLoad.sample", {
                  charge: formatCurrency(sample.charge, cur),
                  units: formatNumber(sample.quantity, 3),
                })
              : t("asset.frontLoad.sampleNone")}
          </p>
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
    </Card>
  );
}
