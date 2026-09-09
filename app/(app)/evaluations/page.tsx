import Link from "next/link";

import { hasSelectedActivities } from "@/lib/onboarding";
import { readProfileForFeed } from "../feed/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadEvaluationHistory, loadPendingEvaluations } from "./data";
import { EvaluationsView } from "./evaluations-view";

export const metadata = { title: "Evaluations — gazelle" };

/** Reads live rows on every visit; a passed occurrence or a fresh submission
 * changes them. */
export const dynamic = "force-dynamic";

/**
 * Evaluations (PRD §3.1-3.4, 3.7), built in spec 09.
 *
 * Gated on activities_selected, same as /feed: without a focus set there is
 * nothing to have selected an occurrence of in the first place.
 */
export default async function EvaluationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <Gate href="/login" label="Sign in">Sign in to see your evaluations.</Gate>;
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
        Pick the activities you want to focus on first. Evaluations start once
        you&apos;ve selected something on the Feed to attend.
      </Gate>
    );
  }

  let pending, history;
  try {
    const now = new Date();
    [pending, history] = await Promise.all([
      loadPendingEvaluations(supabase, user.id, { timezone: profile.timezone, now }),
      loadEvaluationHistory(supabase, user.id),
    ]);
  } catch (cause) {
    return <ErrorPanel cause={cause} />;
  }

  return <EvaluationsView pending={pending} history={history} timezone={profile.timezone} />;
}

function ErrorPanel({ cause }: { cause: unknown }) {
  // Fail loudly (CLAUDE.md) rather than rendering an empty page.
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">Evaluations</h1>
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
      <h1 className="text-2xl font-semibold">Evaluations</h1>
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
