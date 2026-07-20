// Web push sender (COMPETITION.md F5). Wraps the `web-push` library (VAPID JWT
// signing + payload encryption) so the cron never touches its internals. A
// 404/410 from the push service means the subscription is gone (unsubscribed /
// expired) and the caller should delete it.

import "server-only";
import webpush from "web-push";
import type { VapidKeys } from "./push-keys";
import type { PushPayload } from "../push/reminder";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = "sent" | "gone" | "error";

/** Send one notification. Returns "gone" for a 404/410 (dead subscription),
 *  "error" for anything else, "sent" on success. Never throws. */
export async function sendPush(
  keys: VapidKeys,
  target: PushTarget,
  payload: PushPayload,
): Promise<PushResult> {
  if (!keys.publicKey || !keys.privateKey) return "error";
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: keys.subject,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 24 * 60 * 60,
      },
    );
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return "gone";
    return "error";
  }
}
