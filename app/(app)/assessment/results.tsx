import type { InventoryResult } from "@/lib/assessments/catalogue";
import { PHASE_LABELS } from "@/lib/assessments/flow";
import type { DesiredActivity } from "@/lib/schemas/assessment";
import { ResultsActions } from "./results-actions";

/**
 * The assessment results (spec 03 item 5): the scored inventories and the
 * generated persona.
 *
 * The scores are not stored anywhere. They are recomputed by the pure scorer in
 * lib/assessments/catalogue.ts from the raw answers every time this renders,
 * which is why spec 03 needed no migration.
 */

export type Persona = {
  summary: string | null;
  goals: string[];
  traits: string[];
  desired_activities: DesiredActivity[];
  assessment_types_used: string[];
  generated_at: string;
  model_run_id: string | null;
};

const SECTIONS = (["hobbies", "inventory", "desires", "constraints"] as const).map(
  (phase) => ({ phase, label: PHASE_LABELS[phase] }),
);

export function Results({
  persona,
  inventories,
  version,
  totalVersions,
}: {
  persona: Persona;
  inventories: InventoryResult[];
  version: number;
  totalVersions: number;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Your assessment</h1>
        <p className="mt-1 text-xs opacity-60">
          Generated {new Date(persona.generated_at).toLocaleString()}
          {totalVersions > 1 && ` · version ${version} of ${totalVersions}, earlier ones kept`}
          {persona.model_run_id && ` · run ${persona.model_run_id.slice(0, 8)}`}
        </p>
      </header>

      {persona.summary && (
        <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          <h2 className="font-medium">Who you are socially</h2>
          <div className="mt-2 flex flex-col gap-3 text-sm leading-relaxed">
            {persona.summary.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      {persona.goals.length > 0 && (
        <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          <h2 className="font-medium">Your goals</h2>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {persona.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </section>
      )}

      {persona.traits.length > 0 && (
        <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          <h2 className="font-medium">Traits that matter for choosing groups</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {persona.traits.map((trait) => (
              <li
                key={trait}
                className="rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20"
              >
                {trait}
              </li>
            ))}
          </ul>
        </section>
      )}

      {persona.desired_activities.length > 0 && (
        <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          <h2 className="font-medium">Activities you want to pursue</h2>
          <ul className="mt-2 flex flex-col gap-3 text-sm">
            {persona.desired_activities.map((activity) => (
              <li key={activity.name}>
                <p className="font-medium">{activity.name}</p>
                <p className="opacity-75">{activity.rationale}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs opacity-60">
            Spec 04 turns these into the activities you focus on.
          </p>
        </section>
      )}

      {inventories.length > 0 && (
        <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
          <h2 className="font-medium">Inventory results</h2>
          <p className="mt-1 text-xs opacity-60">
            Scored in code from your answers, not by a model.
          </p>

          <div className="mt-4 flex flex-col gap-5">
            {inventories.map((inventory) => (
              <div key={inventory.id}>
                <h3 className="text-sm font-medium">{inventory.name}</h3>
                <p className="mt-0.5 text-xs opacity-60">{inventory.measures}</p>

                <ul className="mt-3 flex flex-col gap-3">
                  {inventory.scales.map((scale) => (
                    <li key={scale.key}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{scale.label}</span>
                        <span className="text-xs opacity-70">
                          {scale.percent === null ? "not answered" : `${scale.percent}%`}
                          {scale.band && ` · ${scale.band}`}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
                        <div
                          className="h-full rounded-full bg-foreground"
                          style={{ width: `${scale.percent ?? 0}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs opacity-75">{scale.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <ResultsActions sections={SECTIONS.map((section) => ({ ...section }))} />
    </div>
  );
}
