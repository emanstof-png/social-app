# REVIEW — spec 04, activity selection and focus

Spec: `docs/specs/04-activity-selection.md` (PRD §1.5–1.7). All six scope items
built. Tag `spec-04`.

This spec was re-drafted before it was built. The original one-page sketch
`04-activities-and-focus.md` predated specs 01–03; item 6 retired it and fixed
the two references. Nothing in the sketch was dropped.

---

## What was built

**1. Schema (`supabase/migrations/0006_activity_kind_and_focus.sql`).**
A Postgres enum `activity_kind` (`recurring_community` | `one_off_source`) and
`activities.kind`, because PRD §1.6 treats the two differently and nothing in
the table said which an activity was. `activities.fit_score` (smallint, 0–100,
check-constrained, nullable) for the model's persona-fit score. `profiles.
focus_cap` (smallint, 2–4, default 3) because PRD §1.7's cap is a number the
user can change. Applied to `wqawpwbgrsjusbdopgbi` and verified against
`information_schema`. Zod updated to match, and `tests/schemas.test.ts` holds
the schemas against the migration SQL as before.

**2. `activity_suggestion`, real prompt (`lib/llm/components/activity-suggestion.ts`).**
The spec 02 stub is gone. Input widened from three fields to six: traits, the
persona's own `desired_activities` with their rationale, every existing
activity whatever its status, and the five constraint answers. Output gains
`kind` and `fit_score`; `supports_goal` must quote a goal it was given. Capped
at 8 suggestions.

**3. Plan engine (`lib/activities/plan.ts`), 37 tests, written before the code.**
Pure functions, no Supabase client: `suggestionInputFrom`, `seedRowsFrom`,
`mergeSuggestions`, `focusState`, `canActivate`, `seasonPlan`. Every workflow
decision lives here; the model fills one narrow joint.

**4. Activities page (`app/(app)/activities/`).** Seeded cards with rationale,
kind badge and fit score; status control (In focus / Set aside / Cut); kind
editable per card; add-your-own; cut items collapsed into a reopenable section.

**5. Focus rule and season plan.** The cap is enforced in the server action.
"This season's plan" is the focus set plus active one-off sources, derived from
the same rows. `activities_selected` added to `ONBOARDING_STATES`.

**6. `e2e/assessment.spec.ts`** — 12a item 2's assessment test, plus the
housekeeping above and the spec 12 line.

---

## How to test it by hand

```bash
npm run build && npx next start     # production, not next dev
```

Sign in at http://localhost:3000/login and open **Activities**.

1. **Seeding.** The activities your assessment named are already cards, each
   with the rationale spec 03 wrote. All of them start *Set aside*: nothing is
   auto-focused.
2. **Suggestions.** Click **Suggest more activities**. New cards arrive with a
   fit score and a "Recurring"/"One-off" badge. Check them against what you
   said in the interview about budget, drinking, travel and free time.
3. **Idempotency.** Click it a second time. No duplicate cards, and nothing you
   had already set or cut changes. Confirm in Supabase:
   `select name, status, source from activities order by created_at;`
3b. **A hand-edited kind survives.** On any suggested card click **Make it
   one-off** (or recurring), then run suggestions again. Your choice stands.
   `select name, kind, kind_edited_by_user from activities;` shows the flag.
4. **The focus cap.** Click **In focus** on three recurring activities, then a
   fourth. It is refused, and the message names what to set aside. Set one
   aside and the fourth goes in.
5. **Cut is not delete.** Cut a card, open the **Cut** section, bring it back.
   Then run suggestions again: it stays cut.
6. **The cap is the server's rule.** Open Activities in two tabs. Fill the
   focus set in tab B, then click **In focus** in tab A, whose buttons still
   believe there is room. The server refuses.
7. **Add your own.** Add something; it joins the focus set if there is room.
   Add a name that already exists and it is brought back rather than erroring.

```bash
npm test            # 247 unit tests pass, 4 skipped (the live-gateway suite)
npx playwright test # login + assessment, against next build + next start
```

---

## Verified (CLAUDE.md sense)

**Both halves.** `next build` passed **and** a production server (`next start`)
was driven under a real magic-link session through the whole feature. The
deployed Vercel URL was **not** exercised; verification was local `next start`.

What a real production run actually did:

- `/activities` returned **200** under a real authenticated session.
- Seeded cards rendered with their spec 03 rationale; all `benched` in the
  database.
- A real `activity_suggestion` call through the gateway returned **6**
  suggestions in ~5s, `status: ok`, `attempts: 1`, one `run_log` row
  (`minimax/minimax-m3:free`, openrouter). Every one respected all five
  constraints — free, alcohol-free, knee-aware, weeknights/Saturday mornings,
  Arlington — with fit scores spread **71–92** rather than bunched.
- A second run produced **no duplicate rows** and **changed no statuses**.
- Filling the focus set and attempting a fourth was refused with the PRD §1.7
  reason; the database still held exactly three.
- **A stale-UI replay from a second browser session was refused by the server**
  — the page's buttons believed there was room, the action did not. That is the
  acceptance criterion that matters, since a server action is a public endpoint.
- `onboarding_state` advanced to `activities_selected`.
- The committed e2e suite (login + assessment) passed against `next build` +
  `next start`.

**One production-only bug, found by this rule and not by the build.** The first
run showed "Nothing on your list yet" on the very render that seeded the rows —
while the rows were demonstrably in the database. Two identical GETs in one
render are memoized by Next, so re-reading after the insert returned the
pre-insert empty list. `next build` passed on it. Fixed by reading the inserted
rows back from the insert itself rather than re-reading
(`app/(app)/activities/data.ts`, comment kept there). Same family as spec 01's
`NAV_ITEMS` bug: invisible until a real production request.

---

## What I was unsure about

1. **Nothing is seeded or suggested active — my decision, not the spec's.** The
   spec says seeded rows carry the persona's rationale and that the focus set is
   the active recurring activities, capped at three. It does not say what status
   a seed arrives with, and the column default is `active`. Seeding five desired
   activities as active would break the cap before the user touched anything, so
   seeds and suggestions both arrive `benched` and the user picks their few —
   which is PRD §1.7's point. The alternative, letting the code pick the first
   three, is the app choosing someone's evenings for them. The cost: a card the
   user has never seen is labelled "Set aside", which reads slightly oddly on a
   first visit.

2. ~~**A re-run can overwrite a user-edited `kind`.**~~ **FIXED after review**
   — see "Correction" at the end of this file. A re-run now updates `kind` only
   while `activities.kind_edited_by_user` is false (migration 0007).

3. **`activities.status` still defaults to `'active'` in Postgres** while every
   insert in the app passes a status explicitly. Not a bug today; it is a trap
   for a later spec that inserts an activity without one. Changing the default
   needs its own migration and was outside this spec.

4. **The e2e test seeds rather than drives the interview.** It puts the user one
   *fixed* question from the end, so resuming and answering need no model call
   at all, and seeds the persona row for the results assertion. That makes it
   reliable in CI, but it means the committed test does not exercise the
   `interview` component itself — spec 03 verified that live, by hand.

5. **Three pre-existing Supabase security advisories** (WARN): `handle_new_user`
   is a `SECURITY DEFINER` function callable via RPC by `anon` and
   `authenticated`, and leaked-password protection is off. Neither comes from
   spec 04 — the function is spec 01's signup trigger, and this app uses magic
   links, not passwords. Left alone as out of scope; worth a line in 12b.

---

## What the next spec needs

- **Spec 05 searches against the focus set**: `activities` where
  `status = 'active'` and `kind = 'recurring_community'`, capped by
  `profiles.focus_cap`. `focusState()` in `lib/activities/plan.ts` computes it;
  use that rather than re-deriving the filter, so the two cannot disagree.
- **`onboarding_state` reaching `activities_selected`** is the signal that a
  focus set exists. Gate discovery on it the way `/assessment` gates on
  `models_configured`.
- **One-off sources are activities too.** `kind = 'one_off_source'` rows are
  active and uncapped, and spec 05 should search them differently — a source of
  individual events, not a group to join. `communities.type` already has a
  matching `one_off_source` value.
- **`communities.focus` is still unused and still spec 05's.** Spec 04
  deliberately did not touch it: the activity-level focus set is derived from
  `status` and `kind`, and per-community focus is a different question.
- **The four GitHub repository secrets are still unset**, so the Playwright CI
  job continues to skip itself — now skipping two suites rather than one.
  `next build` + `next start` under real auth has still never run in CI. Names
  and steps are in STATUS.md. This is the one outstanding action for Eric.
- Suggestions are **user-triggered only**. Nothing here runs on a schedule;
  scheduled discovery is spec 06 and follows the addendum.

---

## Correction after review: a hand-edited `kind` is no longer overwritten

Raised at the review gate, and correct: spec 04 item 3 had a suggestion re-run
update `kind`, while item 4 made `kind` editable on the card. A user could flip
a suggestion to "One-off", run suggestions again, and silently lose the edit.
That is data loss.

**The rule now:** a re-run updates `kind` only while
`activities.kind_edited_by_user` is false. `rationale` and `fit_score` are
still updated either way — only `kind` is protected.

- **Migration 0007** adds `activities.kind_edited_by_user boolean not null
  default false`. Applied to `wqawpwbgrsjusbdopgbi`.
- **Set true** by the card's kind control (`setKind`) and by adding your own
  activity, where the form makes you choose.
- **Stays false** for a suggestion the model classified and for an activity
  seeded from the assessment, where `kind` is only the app's default guess. So
  a re-run may still correct a guess nobody has reviewed.

**Why a flag rather than comparing against the last suggested value.** Both
protect the edit; only the flag can tell an unreviewed default guess from a
decision, so only the flag keeps the useful half of the old behaviour — the
model correcting the app's own `recurring_community` guess on a seeded row.
Storing it is also consistent with the rest of spec 04 rather than a departure
from it: the focus set is not stored because it is a pure function of columns
that already exist, whereas "a person once changed this field" is a fact about
the past that nothing in the current row implies.

`docs/specs/04-activity-selection.md` records the corrected rule in item 3 and
in "Decisions made while drafting", with the reasoning, so the spec and the code
agree.

### Verified

`next build`, lint and 247 unit tests pass (4 new plan tests, written red first,
plus the schema-vs-migration tests picking up the new column).

Against a production server under a real magic-link session:

- A real suggestion run stored 6 suggestions, all `kind_edited_by_user = false`.
- Flipping one to "One-off" **through the real UI** wrote both `kind =
  one_off_source` and `kind_edited_by_user = true` to the database.
- A second real suggestion run left the edit intact.
- The activity seeded from the assessment stayed `kind_edited_by_user = false`,
  so it can still be corrected.

**One honest limit on that run.** The second suggestion call returned no
overlapping name — the prompt tells the model not to repeat what is already on
the list — so the production run shows the edit surviving but does not itself
execute the merge's `kind` branch. That branch is covered directly by
`tests/plan.test.ts` ("never overwrites a kind the user set by hand", "still
updates rationale and fit_score on a hand-edited activity", "still corrects a
kind nobody has reviewed").

**Also worth knowing:** a free model sometimes returns a valid, schema-clean
`{"suggestions": []}` — an `ok` run_log row with nothing in it. The action
already handles that ("Nothing new this time…"), but it means a verification
script cannot assume one click yields suggestions.
