import Link from "next/link";

import { dayKeyIn, monthGrid } from "@/lib/feed/occurrences";
import { hasSelectedActivities } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadFeedData, readProfileForFeed } from "./data";
import { FeedView } from "./feed-view";

export const metadata = { title: "Feed — gazelle" };

/** Reads live rows on every visit; a scrape or a selection changes them. */
export const dynamic = "force-dynamic";

/**
 * Feed and calendar, merged into one view (PRD §2.5 fix, 2026-09-08): a
 * month grid alongside the same flat, chronological list of every scraped
 * event within the feed window, across every non-archived community -- not
 * grouped by activity or gated behind the current focus set (see spec 07's
 * drafting decisions). `/calendar` used to be a second page over this same
 * read, added by spec 07 and then narrowed by its own addendum to a
 * committed-only view specifically to avoid duplicating this page's full
 * browse-and-pick list. Folding the grid back in here removes that
 * duplication at the root instead, so the grid's day markers and the
 * day-click scroll target are this page's own full `byDay` -- every
 * scraped event, not just committed ones -- matching what the list right
 * next to it actually shows. `/calendar` itself now just redirects here.
 *
 * Month navigation is a `?month=YYYY-MM` search param, not client state,
 * carried over from `/calendar`'s own precedent: every other page in this
 * app is a server component driven by server actions and revalidatePath.
 */
export default async function FeedPage({ searchParams }: PageProps<"/feed">) {
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

  const now = new Date();
  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const { year, month } = parseMonthParam(monthParam, now, profile.timezone);

  let data;
  try {
    data = await loadFeedData(supabase, user.id, { timezone: profile.timezone, now });
  } catch (cause) {
    return <ErrorPanel cause={cause} />;
  }

  // The grid never recomputes what counts as "has an event" -- it reuses the
  // same day keys groupByDay already produced for the list right next to it.
  const hasEventsOn = new Set(data.byDay.map((group) => group.day));
  const grid = monthGrid(year, month, hasEventsOn);

  return (
    <FeedView
      byDay={data.byDay}
      todayKey={dayKeyIn(now, profile.timezone)}
      timezone={profile.timezone}
      year={year}
      month={month}
      grid={grid}
    />
  );
}

/** Defaults to the current month in the profile's timezone. */
function parseMonthParam(
  raw: string | undefined,
  now: Date,
  timezone: string,
): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  const [y, m] = dayKeyIn(now, timezone).split("-").map(Number);
  return { year: y, month: m };
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
