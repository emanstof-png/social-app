import Link from "next/link";

import {
  hasCompletedAssessment,
  hasConfiguredModels,
  hasSelectedActivities,
} from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CommunitiesView, type ActivityGroup } from "./communities-view";
import { loadCommunitiesData } from "./data";

export const metadata = { title: "Communities — gazelle" };

/** Reads live rows on every visit; a run's progress changes between them. */
export const dynamic = "force-dynamic";

/**
 * Communities (PRD §2.1-2.2), built in spec 05.
 *
 * Gated on activities_selected: discovery searches against the focus set, so
 * without one there is nothing to search for.
 */
export default async function CommunitiesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <Gate href="/login" label="Sign in">Sign in to see your communities.</Gate>;
  }

  let data;
  try {
    data = await loadCommunitiesData(supabase, user.id);
  } catch (cause) {
    // Fail loudly (CLAUDE.md) rather than rendering an empty page.
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="text-2xl font-semibold">Communities</h1>
        <p
          className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
          role="alert"
        >
          {cause instanceof Error ? cause.message : String(cause)}
        </p>
      </div>
    );
  }

  const state = data.onboardingState;

  // Same gate shape as /activities: a plain explanation, not a redirect the
  // user cannot account for.
  if (!hasConfiguredModels(state)) {
    return (
      <Gate>
        Choose your models first. Discovery plans and reads through the LLM
        gateway, so every component needs a model before this page can do
        anything.
      </Gate>
    );
  }

  if (!hasCompletedAssessment(state)) {
    return (
      <Gate href="/assessment" label="Go to the assessment">
        Finish the assessment first. Your activities come out of it, and
        communities are found for those activities.
      </Gate>
    );
  }

  if (!hasSelectedActivities(state)) {
    return (
      <Gate href="/activities" label="Go to activities">
        Pick the activities you want to focus on first. Discovery searches for
        real local organizations for each one, so the focus set comes first.
      </Gate>
    );
  }

  const groups: ActivityGroup[] = data.focus.map((activity) => {
    const run = data.runByActivity.get(activity.id) ?? null;
    return {
      id: activity.id,
      name: activity.name,
      rationale: activity.rationale,
      communities: data.communitiesByActivity.get(activity.id) ?? [],
      run,
      queriesTried: run ? (data.queriesByRun.get(run.id) ?? []) : [],
    };
  });

  return <CommunitiesView groups={groups} homeLocation={data.homeLocation} />;
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
      <h1 className="text-2xl font-semibold">Communities</h1>
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
