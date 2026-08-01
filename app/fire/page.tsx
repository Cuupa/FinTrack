import { redirect } from "next/navigation";

// Merged into /retirement (TODO "FIRE/Rente"): the FIRE planner and the
// pension projection answer one question and are now two tabs of one page.
//
// The route stays and redirects rather than 404s, same call as /spending after
// the accounts merge: it has been in the nav, in the PWA's install scope and
// in browser histories since the feature shipped, and `?tab=fire` lands a
// bookmark on the half it was pointing at.
export default function FirePage() {
  redirect("/retirement?tab=fire");
}
