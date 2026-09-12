import { NextResponse, type NextRequest } from "next/server";

import { loadPendingEvaluations } from "@/app/(app)/evaluations/data";
import { buildEvaluationPrompt } from "@/lib/push/notification";
import { sendPushToSubscription, serverPushDeps } from "@/lib/push/webpush-server";
import { pushSubscriptionRow, type PushSubscriptionRow } from "@/lib/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Sends "how was it?" pushes for every planned occurrence that has passed
 * and has not yet been prompted for (spec 09 item 5).
 *
 * Vercel invokes this once daily (vercel.json) carrying no Supabase session
 * -- CRON_SECRET, checked here, is this route's whole authorization
 * (docs/specs/09-evaluation-and-push.md decision 3; lib/supabase/proxy.ts's
 * PUBLIC_PATHS lets it through the session gate for exactly this reason).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const pushDeps = serverPushDeps();

    const { data: profileRows, error: profileError } = await admin
      .from("profiles")
      .select("user_id, timezone");
    if (profileError) throw new Error(`Could not read profiles: ${profileError.message}`);

    let sent = 0;
    let prompted = 0;

    for (const profile of profileRows ?? []) {
      const userId = profile.user_id as string;
      const timezone = (profile.timezone as string | null) || "America/New_York";
      const now = new Date();

      const pending = (
        await loadPendingEvaluations(admin, userId, { timezone, now })
      ).filter((card) => card.evaluationPromptedAt === null);
      if (pending.length === 0) continue;

      const { data: subscriptionRows, error: subscriptionError } = await admin
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh_key, auth_key, created_at")
        .eq("user_id", userId);
      if (subscriptionError) {
        throw new Error(`Could not read push subscriptions: ${subscriptionError.message}`);
      }

      let liveSubscriptions: PushSubscriptionRow[] = (subscriptionRows ?? []).map((row) =>
        pushSubscriptionRow.parse(row),
      );

      for (const card of pending) {
        const payload = buildEvaluationPrompt({
          eventTitle: card.title,
          communityName: card.communityName,
        });

        const stillLive: PushSubscriptionRow[] = [];
        for (const subscription of liveSubscriptions) {
          try {
            const result = await sendPushToSubscription(pushDeps, subscription, payload);
            if (result.dead) {
              await admin.from("push_subscriptions").delete().eq("id", subscription.id);
            } else {
              stillLive.push(subscription);
              sent += 1;
            }
          } catch (cause) {
            // Fail loudly (CLAUDE.md): logged, but one bad send never stops
            // the loop over the remaining cards/subscriptions.
            console.error(`Push to ${subscription.endpoint} failed:`, cause);
            stillLive.push(subscription);
          }
        }
        liveSubscriptions = stillLive;

        // Stamped regardless of outcome -- sent, no subscription, or a
        // logged failure all count as "attempted" (decision 2), so this
        // occurrence is not re-notified on tomorrow's run.
        const { error: stampError } = await admin
          .from("selections")
          .update({ evaluation_prompted_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("event_id", card.eventId)
          .eq("occurrence_at", card.occurrenceAt);
        if (stampError) {
          console.error(
            `Could not stamp evaluation_prompted_at for ${card.eventId}:`,
            stampError,
          );
        } else {
          prompted += 1;
        }
      }
    }

    return NextResponse.json({ ok: true, prompted, sent });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("evaluation-prompts cron failed:", cause);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
