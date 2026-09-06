import Link from "next/link";

import { hasCompletedAssessment, hasConfiguredModels } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ActivitiesView } from "./activities-view";
import { loadActivitiesData } from "./data";

export const metadata = { title: "Activities — gazelle" };

/** Reads the live rows on every visit; the focus set is derived from them. */
export const dynamic = "force-dynamic";

/**
 * Activities and focus (PRD §1.5-1.7), built in spec 04.
 *
 * The persona's desired activities are seeded as rows on the first visit after
 * the assessment, so the page has something on it without any further setup.
 * Nothing is seeded active: the user picks the few to focus on, which is the
 * point of PRD §1.7.
 */
export default async function ActivitiesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("onboarding_state")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const state = profile?.onboarding_state ?? "new";

  // Same gate shape as /assessment (spec 02 item 4): a plain explanation rather
  // than a redirect the user cannot account for.
  if (!hasConfiguredModels(state)) {
    return (
      <Gate>
        Choose your models first. Suggestions run through the LLM gateway, so
        every component needs a model before this page can do anything.
      </Gate>
    );
  }

  if (!hasCompletedAssessment(state)) {
    return (
      <Gate href="/assessment" label="Go to the assessment">
        Finish the assessment first. Your activities come out of it — what you
        said you want, and what fits the rest of your answers.
      </Gate>
    );
  }

  let data;
  try {
    data = await loadActivitiesData(supabase, user!.id);
  } catch (cause) {
    // Fail loudly (CLAUDE.md) rather than rendering an empty page.
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="text-2xl font-semibold">Activities</h1>
        <p
          className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
          role="alert"
        >
          {cause instanceof Error ? cause.message : String(cause)}
        </p>
      </div>
    );
  }

  return (
    <ActivitiesView
      activities={data.activities}
      cap={data.cap}
      canSuggest={data.assessment !== null && data.assessment.goals.length > 0}
    />
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
      <h1 className="text-2xl font-semibold">Activities</h1>
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
