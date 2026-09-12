import webpush from "web-push";

import type { PushSubscriptionRow } from "@/lib/schemas";
import type { PushPayload } from "./notification";

/**
 * Web Push, the impure half (spec 09 item 3).
 *
 * Server-only. Never import this from a "use client" module.
 */

/** A URL, not a personal mailto address -- the RFC 8292 subject is a contact
 * a push service can use if this app ever misbehaves; the deployed site's
 * own URL identifies it without carrying anyone's email address. */
const VAPID_SUBJECT = "https://gazelle-psi.vercel.app";

/** Matches GatewayDeps's/GoogleOAuthDeps's own shape: the impure edge as a
 * single deps object, so a test drives the real logic with no network. */
export type PushDeps = {
  sendNotification: typeof webpush.sendNotification;
  vapidPublicKey: string;
  vapidPrivateKey: string;
};

export type PushSendResult = { dead: boolean };

/**
 * Sends one notification to one subscription. A 404/410 (the subscription
 * is gone -- the browser unsubscribed, or the push service dropped it) is
 * reported back as `{ dead: true }` rather than thrown, the same
 * "already gone" shape deleteCalendarEvent (lib/google/calendar-server.ts)
 * uses for an event already removed from Google -- applied here to "this
 * subscription is dead, stop calling it" instead. Any other failure throws
 * (CLAUDE.md: fail loudly).
 */
export async function sendPushToSubscription(
  deps: PushDeps,
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<PushSendResult> {
  try {
    await deps.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh_key, auth: subscription.auth_key },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: VAPID_SUBJECT,
          publicKey: deps.vapidPublicKey,
          privateKey: deps.vapidPrivateKey,
        },
      },
    );
    return { dead: false };
  } catch (cause) {
    const statusCode = (cause as { statusCode?: unknown }).statusCode;
    if (statusCode === 404 || statusCode === 410) return { dead: true };
    throw cause;
  }
}

/** Production wiring: the real web-push sendNotification, real
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY. Throws if either is
 * missing, the same not-configured shape every other subsystem's server
 * wiring (e.g. serverGoogleOAuthDeps) throws for a missing credential. */
export function serverPushDeps(): PushDeps {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error(
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set. Set both in .env.local " +
        "(local) and in the Vercel project settings (deployed).",
    );
  }

  return { sendNotification: webpush.sendNotification, vapidPublicKey, vapidPrivateKey };
}
