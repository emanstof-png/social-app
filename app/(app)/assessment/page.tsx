import Link from "next/link";

import { isComplete, progressFrom, scoredInventoriesFrom, type StoredAnswer } from "@/lib/assessments/flow";
import { hasConfiguredModels } from "@/lib/onboarding";
import { assessmentRow } from "@/lib/schemas/assessment";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Interview } from "./interview";
import { Results, type Persona } from "./results";
import { answeredSummaries } from "./view";

export const metadata = { title: "Assessment — gazelle" };

/** Reads the live onboarding state and the stored answers on every visit. */
export const dynamic = "force-dynamic";

/**
 * The assessment (PRD §1.1-1.4), built in spec 03.
 *
 * Which of the two views renders is derived from the stored rows, not from any
 * session: an unfinished interview shows the interview, a finished one with a
 * generated assessment shows the results. Redoing a section makes the interview
 * unfinished again and this page follows it back.
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

  /**
   * Spec 02 scope item 4: model setup is onboarding step 1 and must be
   * completed before the assessment. The assessment is the first thing that
   * calls a model, so starting it without one configured would fail on the
   * first question.
   *
   * The gate lives here rather than in proxy.ts so it stays a plain, visible
   * explanation rather than a redirect the user cannot account for.
   */
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

  const { data: answerRows, error: answersError } = await supabase
    .from("assessment_answers")
    .select("question_id, question_text, answer")
    .eq("user_id", user!.id);

  if (answersError) {
    return <Failure message={`Could not read your answers: ${answersError.message}`} />;
  }

  const answers = (answerRows ?? []) as StoredAnswer[];

  // A corrupt closing marker raises rather than being guessed around
  // (CLAUDE.md: fail loudly). Surface it instead of a blank page.
  let finished: boolean;
  try {
    finished = isComplete(answers);
  } catch (cause) {
    return <Failure message={cause instanceof Error ? cause.message : String(cause)} />;
  }

  const { data: assessments, error: assessmentError } = await supabase
    .from("assessments")
    .select(
      "summary, goals, traits, desired_activities, assessment_types_used, generated_at, model_run_id",
    )
    .eq("user_id", user!.id)
    .order("generated_at", { ascending: false });

  if (assessmentError) {
    return <Failure message={`Could not read your assessment: ${assessmentError.message}`} />;
  }

  const latest = assessments?.[0];

  if (finished && latest) {
    // Validated on the way out of the database, like every other row (spec 01).
    const parsed = assessmentRow
      .pick({
        summary: true,
        goals: true,
        traits: true,
        desired_activities: true,
        assessment_types_used: true,
        generated_at: true,
        model_run_id: true,
      })
      .safeParse(latest);

    if (!parsed.success) {
      return (
        <Failure
          message={
            "The stored assessment does not match its schema: " +
            parsed.error.issues.map((issue) => issue.message).join("; ")
          }
        />
      );
    }

    return (
      <Results
        persona={parsed.data as Persona}
        inventories={scoredInventoriesFrom(answers)}
        version={assessments.length}
        totalVersions={assessments.length}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Assessment</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-70">
          One question at a time. Every answer is saved as you give it, so you
          can close this and come back to the same place.
        </p>
      </header>

      <Interview
        initial={{
          progress: progressFrom(answers),
          answered: answeredSummaries(answers),
        }}
      />
    </div>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">Assessment</h1>
      <p
        className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm"
        role="alert"
      >
        {message}
      </p>
    </div>
  );
}
