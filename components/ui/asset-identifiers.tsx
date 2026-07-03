"use client";

// Renders an asset's identifiers (WKN/ISIN/symbol) with one copy icon per
// value — never a single click that copies both WKN and ISIN at once (see
// `assetIdentifier` in lib/types.ts, which stays a plain "WKN · ISIN" string
// for display-only contexts). When both WKN and ISIN exist, each gets its own
// `CopyValue`, separated by a non-copyable "·".

import { Fragment } from "react";
import { CopyValue } from "@/components/ui/copy-value";
import type { Asset } from "@/lib/types";

export function AssetIdentifiers({
  asset,
  chipClassName,
}: {
  asset: Asset;
  chipClassName?: string;
}) {
  const ids = asset.wkn && asset.isin
    ? [asset.wkn, asset.isin]
    : asset.isin || asset.wkn || asset.symbol
      ? [asset.isin || asset.wkn || asset.symbol!]
      : [];

  if (ids.length === 0) {
    return chipClassName ? <span className={chipClassName}>—</span> : <>—</>;
  }

  return (
    <>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && <span className="text-zinc-400"> · </span>}
          <CopyValue value={id}>
            {chipClassName ? <span className={chipClassName}>{id}</span> : id}
          </CopyValue>
        </Fragment>
      ))}
    </>
  );
}
