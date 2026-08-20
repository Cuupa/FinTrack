import { redirect } from "next/navigation";

// Household administration moved into Settings (spec §13): managing WHO shares
// the data is account admin, not a top-level financial area. The route stays
// and redirects rather than 404s, same call as /fire after the retirement
// merge: it has been in the nav, in the PWA's install scope and in browser
// histories since the feature shipped, and `?tab=household` lands a bookmark on
// the settings tab it now lives in.
export default function HouseholdPage() {
  redirect("/settings?tab=household");
}
