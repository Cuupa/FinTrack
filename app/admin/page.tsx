"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Card } from "@/components/ui/primitives";

export default function AdminOverviewPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.overview.title")}</h1>
        <p className="text-sm text-zinc-500">{t("admin.overview.subtitle")}</p>
      </div>
      <Card>
        <h2 className="text-lg font-semibold">{t("admin.overview.linksTitle")}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <Link
              href="/admin/flags"
              className="text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {t("admin.nav.flags")}
            </Link>
          </li>
        </ul>
      </Card>
    </div>
  );
}
