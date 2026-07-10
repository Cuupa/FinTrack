"use client";

import { use } from "react";
import { AssetDetail } from "@/components/assets/asset-detail";

export default function InstrumentPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = use(params);
  return <AssetDetail instrumentKey={decodeURIComponent(key)} />;
}
