import { redirect } from "next/navigation";

// Bookings merged into /accounts (owner call, round 28): an account and the
// bookings against it are one thing, and a second page rendering the same
// cards was exactly the split the merge removed.
//
// The route stays and redirects rather than 404s. It has been in the nav, in
// the PWA's install scope and in browser histories since the feature shipped,
// and a bookmark that suddenly dead-ends is a worse answer than a hop.
export default function SpendingPage() {
  redirect("/accounts");
}
