import Link from "next/link";

import { committedOnly, dayKeyIn, groupByDay, monthGrid } from "@/lib/feed/occurrences";
import { hasSelectedActivities } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadFeedData, readProfileForFeed } from "../feed/data";
import { CalendarView } from "./calendar-view";

export const metadata = { title: "Calendar — gazelle" };

/** Reads live rows on every visit; a scrape or a selection changes them. */
export const dynamic = "force-dynamic";

/**
 * Calendar (PRD §2.5), built in spec 07.
 *
 * A second presentation over the Feed's own read and actions, not a second
 * read path -- no data.ts or actions.ts of its own (see the spec's drafting
 * decision). Month navigation is a `?month=YYYY-MM` search param, not client
 * state: every other page in this app is a server component driven by
 * server actions and revalidatePath.
 */
export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <Gate href="/login" label="Sign in">Sign in to see your calendar.</Gate>;
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

  // Committed only (spec 07 addendum: calendar-and-community-fields,
  // decision 1) -- /calendar shows "what am I attending," not another
  // browse-and-pick list. /feed stays unfiltered.
  const committedByDay = groupByDay(committedOnly(data.cards), profile.timezone);

  // The set groupByDay already produced -- the grid never recomputes what
  // counts as "has an event."
  const hasEventsOn = new Set(committedByDay.map((group) => group.day));
  const grid = monthGrid(year, month, hasEventsOn);

  return (
    <CalendarView
      year={year}
      month={month}
      grid={grid}
      byDay={committedByDay}
      timezone={profile.timezone}
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
      <h1 className="text-2xl font-semibold">Calendar</h1>
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
      <h1 className="text-2xl font-semibold">Calendar</h1>
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
