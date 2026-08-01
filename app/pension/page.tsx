import { redirect } from "next/navigation";

// Merged into /retirement (TODO "FIRE/Rente") — see app/fire/page.tsx.
export default function PensionPage() {
  redirect("/retirement?tab=pension");
}
