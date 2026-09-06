import Link from "next/link";

import { hasConfiguredModels } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Placeholder } from "../placeholder";

export const metadata = { title: "Assessment — gazelle" };

/** Reads the live onboarding state on every visit. */
export const dynamic = "force-dynamic";

/**
 * Spec 02 scope item 4: model setup is onboarding step 1 and must be completed
 * before the assessment. The assessment is the first thing that calls a model,
 * so starting it without one configured would fail on the first question.
 *
 * The gate lives here rather than in proxy.ts so it stays a plain, visible
 * explanation rather than a redirect the user cannot account for.
 */
export default async function AssessmentPage() {
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

  if (!hasConfiguredModels(profile?.onboarding_state ?? "new")) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="text-2xl font-semibold">Assessment</h1>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          Choose your models first. The assessment interview runs through the
          LLM gateway, so every component needs a model before it can start.
        </p>
        <Link
          href="/settings"
          className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  return <Placeholder name="Assessment" spec="03" />;
}
