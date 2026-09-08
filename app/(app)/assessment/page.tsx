import Link from "next/link";

import { isComplete, progressFrom, type StoredAnswer } from "@/lib/assessments/flow";
import { hasConfiguredModels } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadResultsPhase } from "./data";
import { Interview } from "./interview";
import { Cogitating, GatewayFailure } from "./generating";
import { Results } from "./results";
import { answeredSummaries } from "./view";

export const metadata = { title: "Assessment — gazelle" };

/** Reads the live onboarding state and the stored answers on every visit. */
export const dynamic = "force-dynamic";

/**
 * The assessment (PRD §1.1-1.4), built in spec 03, reworked by the spec 03
 * rework addendum.
 *
 * Which view renders is derived from the stored rows, not from any session:
 * an unfinished interview shows the interview; a finished one whose
 * background persona_synthesis (docs/CONVENTIONS.md#background-work-after-
 * the-response) hasn't landed yet shows a cogitating state that polls; a
 * finished one with a failed run shows Retry; a finished one with a
 * generated assessment shows the results. Redoing a section makes the
 * interview unfinished again and this page follows it back.
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

  if (!finished) {
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

  const phase = await loadResultsPhase(supabase, user!.id, answers);

  if (phase.kind === "malformed") {
    return <Failure message={phase.message} />;
  }

  if (phase.kind === "cogitating") {
    return <Cogitating />;
  }

  if (phase.kind === "failed") {
    return <GatewayFailure error={phase.error} />;
  }

  return (
    <Results
      persona={phase.persona}
      inventories={phase.inventories}
      version={phase.version}
      totalVersions={phase.totalVersions}
    />
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
