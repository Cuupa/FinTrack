// Public VAPID key for the browser to create a push subscription (F5). The
// public key is not secret; a null response (keys unset) tells the client push
// is unavailable so it hides the opt-in.

import { getVapidKeys } from "@/lib/server/push-keys";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { publicKey } = await getVapidKeys();
  return Response.json({ publicKey: publicKey ?? null });
}
