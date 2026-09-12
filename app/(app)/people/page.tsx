import Link from "next/link";

import { hasSelectedActivities } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readProfileForFeed } from "../feed/data";
import { loadPeopleData } from "./data";
import { PeopleView } from "./people-view";

export const metadata = { title: "People — gazelle" };

/** Reads live rows on every visit; adding/editing/logging changes them. */
export const dynamic = "force-dynamic";

/**
 * People / CRM (PRD §4.1-4.3, 4.5), built in spec 10.
 *
 * Gated on activities_selected, the same reasoning as every other
 * post-onboarding page: the "met at" community/event dropdowns have nothing
 * to show before that point, and there is no CRM-specific onboarding state to
 * add for a distinction the data itself doesn't need.
 */
export default async function PeoplePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <Gate href="/login" label="Sign in">Sign in to see your people.</Gate>;
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
        Pick the activities you want to focus on first. The &quot;met at&quot;
        community and event pickers here have nothing to show before that.
      </Gate>
    );
  }

  let data;
  try {
    data = await loadPeopleData(supabase, user.id);
  } catch (cause) {
    return <ErrorPanel cause={cause} />;
  }

  return <PeopleView data={data} timezone={profile.timezone} />;
}

function ErrorPanel({ cause }: { cause: unknown }) {
  // Fail loudly (CLAUDE.md) rather than rendering an empty page.
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">People</h1>
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
      <h1 className="text-2xl font-semibold">People</h1>
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
