import { redirect } from "next/navigation";

// X-Ray is no longer a standalone destination: it lives as a tab on /analysis
// (spec §9/P5.1). This route stays only to keep old links and bookmarks alive.
export default function XrayPage() {
  redirect("/analysis?tab=xray");
}
