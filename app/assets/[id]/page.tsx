"use client";

import { use } from "react";
import { AssetDetail } from "@/components/assets/asset-detail";

export default function AssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <AssetDetail assetId={id} />;
}
