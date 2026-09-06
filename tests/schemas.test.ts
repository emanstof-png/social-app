import { describe, expect, it } from "vitest";
import type { z } from "zod";

import * as schemas from "@/lib/schemas";
import { enumLabels, tableColumns } from "./migration-sql";

/**
 * The schemas in lib/schemas exist to describe what is actually in Postgres.
 * These tests hold them against supabase/migrations directly, so a column added
 * to a migration without a matching schema change fails here rather than at
 * runtime in a query.
 */

const rowSchemas: Record<string, z.ZodObject> = {
  profiles: schemas.profileRow,
  assessment_answers: schemas.assessmentAnswerRow,
  assessments: schemas.assessmentRow,
  activities: schemas.activityRow,
  communities: schemas.communityRow,
  events: schemas.eventRow,
  selections: schemas.selectionRow,
  evaluations: schemas.evaluationRow,
  contacts: schemas.contactRow,
  interactions: schemas.interactionRow,
  invite_suggestions: schemas.inviteSuggestionRow,
  model_settings: schemas.modelSettingRow,
  provider_keys: schemas.providerKeyRow,
  run_log: schemas.runLogRow,
};

const enumSchemas: Record<string, z.ZodEnum<Record<string, string>>> = {
  activity_source: schemas.activitySource,
  activity_status: schemas.activityStatus,
  community_type: schemas.communityType,
  calendar_kind: schemas.calendarKind,
  community_status: schemas.communityStatus,
  event_type: schemas.eventType,
  selection_status: schemas.selectionStatus,
  preference_entity_type: schemas.preferenceEntityType,
  interaction_kind: schemas.interactionKind,
  invite_suggestion_status: schemas.inviteSuggestionStatus,
  llm_component: schemas.llmComponent,
  llm_provider: schemas.llmProvider,
  record_status: schemas.recordStatus,
  run_status: schemas.runStatus,
  run_error_kind: schemas.runErrorKind,
};

describe("schemas match the migrations", () => {
  const columns = tableColumns();
  const labels = enumLabels();

  it("covers every table in the migrations", () => {
    // preference_log is checked separately: its schema is wrapped in a refine,
    // so it has no .shape to compare positionally.
    const covered = [...Object.keys(rowSchemas), "preference_log"].sort();
    expect(covered).toEqual(Object.keys(columns).sort());
  });

  it.each(Object.keys(rowSchemas))("%s row schema has the table's columns", (table) => {
    expect(Object.keys(rowSchemas[table].shape).sort()).toEqual(
      [...columns[table]].sort(),
    );
  });

  it("preference_log row schema has the table's columns", () => {
    const parsed = schemas.preferenceLogRow.parse({
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      entity_type: "genre",
      entity_id: null,
      entity_name: "sailing",
      liked: true,
      note: null,
      logged_at: "2026-09-05T22:14:03.123456+00:00",
      created_at: "2026-09-05T22:14:03.123456+00:00",
    });
    expect(Object.keys(parsed).sort()).toEqual([...columns.preference_log].sort());
  });

  it("covers every enum in the migrations", () => {
    expect(Object.keys(enumSchemas).sort()).toEqual(Object.keys(labels).sort());
  });

  it.each(Object.keys(enumSchemas))("%s has the SQL enum's labels", (name) => {
    expect(enumSchemas[name].options.sort()).toEqual([...labels[name]].sort());
  });
});

describe("row schemas reject bad data", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-09-05T22:14:03.123456+00:00",
    updated_at: "2026-09-05T22:14:03.123456+00:00",
  };

  const activity = {
    ...base,
    name: "Rucking",
    rationale: "Supports discipline",
    source: "assessment",
    status: "active",
  };

  it("accepts a realistic activity row", () => {
    expect(schemas.activityRow.parse(activity)).toMatchObject({ name: "Rucking" });
  });

  it("rejects an enum value Postgres would reject", () => {
    expect(() =>
      schemas.activityRow.parse({ ...activity, status: "paused" }),
    ).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() => schemas.activityRow.parse({ ...activity, id: "nope" })).toThrow();
  });

  it("rejects a timestamp that is not parseable", () => {
    expect(() =>
      schemas.activityRow.parse({ ...activity, created_at: "last tuesday" }),
    ).toThrow();
  });

  it("accepts the timestamp format PostgREST returns", () => {
    for (const value of [
      "2026-09-05T22:14:03+00:00",
      "2026-09-05T22:14:03.123456+00:00",
      "2026-09-05T22:14:03Z",
    ]) {
      expect(schemas.timestamptz.parse(value)).toBe(value);
    }
  });

  it("enforces the 1-5 rating range the check constraints enforce", () => {
    const evaluation = {
      ...base,
      event_id: "33333333-3333-4333-8333-333333333333",
      attended: true,
      liked: true,
      connections_quality: 4,
      culture_notes: null,
      ease_of_meeting: 3,
      answered_at: null,
    };
    expect(schemas.evaluationRow.parse(evaluation).connections_quality).toBe(4);
    expect(() =>
      schemas.evaluationRow.parse({ ...evaluation, connections_quality: 6 }),
    ).toThrow();
    expect(() =>
      schemas.evaluationRow.parse({ ...evaluation, ease_of_meeting: 0 }),
    ).toThrow();
  });

  it("requires an entity_id or entity_name on a preference, as the check constraint does", () => {
    expect(() =>
      schemas.preferenceLogInsert.parse({
        user_id: base.user_id,
        entity_type: "venue",
        liked: false,
      }),
    ).toThrow();

    expect(
      schemas.preferenceLogInsert.parse({
        user_id: base.user_id,
        entity_type: "venue",
        entity_name: "Sailing Club 2",
        liked: false,
      }),
    ).toMatchObject({ entity_name: "Sailing Club 2" });
  });
});

describe("insert schemas", () => {
  it("does not require database-generated columns", () => {
    const parsed = schemas.communityInsert.parse({
      user_id: "22222222-2222-4222-8222-222222222222",
      name: "Arlington Rucking Club",
      type: "community_event",
    });
    expect(parsed).toMatchObject({ name: "Arlington Rucking Club" });
    expect(parsed).not.toHaveProperty("id");
  });

  it("still requires the columns Postgres marks not null", () => {
    expect(() =>
      schemas.communityInsert.parse({
        user_id: "22222222-2222-4222-8222-222222222222",
        name: "Arlington Rucking Club",
      }),
    ).toThrow();
  });
});
