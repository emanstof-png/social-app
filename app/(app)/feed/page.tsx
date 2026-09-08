import Link from "next/link";

import { dayKeyIn } from "@/lib/feed/occurrences";
import { hasSelectedActivities } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadFeedData, readProfileForFeed } from "./data";
import { FeedView } from "./feed-view";

export const metadata = { title: "Feed — gazelle" };

/** Reads live rows on every visit; a scrape or a selection changes them. */
export const dynamic = "force-dynamic";

/**
 * Feed (PRD §2.4), built in spec 07.
 *
 * A flat, chronological list of every scraped event within the feed window,
 * across every non-archived community -- not grouped by activity or gated
 * behind the current focus set (see the spec's drafting decisions).
 */
export default async function FeedPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <Gate href="/login" label="Sign in">Sign in to see your feed.</Gate>;
  }

  let profile;
  try {
    profile = await readProfileForFeed(supabase, user.id);
  } catch (cause) {
    return <ErrorPanel cause={cause} />;
  }

  if (!hasSelectedActivities(profile.onboardingState)) {
    return (
      <Gate href="/activities" label="Go to activities">
        Pick the activities you want to focus on first. Communities and their
        events come from that set.
      </Gate>
    );
  }

  let data;
  try {
    const now = new Date();
    data = await loadFeedData(supabase, user.id, { timezone: profile.timezone, now });
  } catch (cause) {
    return <ErrorPanel cause={cause} />;
  }

  return (
    <FeedView
      byDay={data.byDay}
      todayKey={dayKeyIn(new Date(), profile.timezone)}
      timezone={profile.timezone}
    />
  );
}

function ErrorPanel({ cause }: { cause: unknown }) {
  // Fail loudly (CLAUDE.md) rather than rendering an empty page.
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">Feed</h1>
      <p
        className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
        role="alert"
      >
        {cause instanceof Error ? cause.message : String(cause)}
      </p>
    </div>
  );
}

function Gate({
  children,
  href = "/settings",
  label = "Go to Settings",
}: {
  children: React.ReactNode;
  href?: string;
  label?: string;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">Feed</h1>
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        {children}
      </p>
      <Link
        href={href}
        className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background"
      >
        {label}
      </Link>
    </div>
  );
}
