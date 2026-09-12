# REVIEW — spec 09 review-fixes addendum

Built 2026-09-12 by the loop, from `docs/specs/09-review-fixes-addendum.md`
only. This is not spec 09 itself (already built, tagged `spec-09`, Done) —
it resolves `REVIEW-FLAGS.md`'s one `blocking` finding from spec 09's review
gate: the cut/returning guard in `submitEvaluation` had no test proving it.
Tag `spec-09-review-fixes`, not `spec-09` (that tag already exists on a
different commit).

## What was built

The addendum's single scope item, Low tier per `CLAUDE.md` (a test addition
against already-correct, already-shipped code — no new application logic,
migration, or server action):

- **`e2e/evaluations.spec.ts` gained two new tests** (a parametrized loop
  over `['cut', 'returning']`, reading more clearly here than two separate
  copies), reusing every existing fixture helper unchanged
  (`seedFixture`/`clearFixture`/`adminClient`/`testUserEmail`/
  `magicLinkTokenHash`/`setOnboarding`/`pastOccurrenceAt`/`FIXTURE_*`). Each
  test overrides the fixture community's `status` after `beforeEach`'s
  `seedFixture` call via a direct admin-client `update`, drives a real
  `attended: true, liked: true` submission through the UI exactly like the
  file's first existing test, and confirms via the admin client that
  `communities.status` is unchanged (`'cut'` stays `'cut'`, `'returning'`
  stays `'returning'`) while `times_visited` still increments by one —
  proving both the guard (no false promotion to `'returning'`) and Decision
  7 ("a visit is a visit, liked or not") in the same assertion.
- **No code change to `submitEvaluation`'s guard itself.** Per the
  addendum's own instruction, the guard at `app/(app)/evaluations/
  actions.ts` (`if (liked && (currentStatus === "todo" || currentStatus ===
  "went_once"))` before the `status: "returning"` write) was read and
  confirmed correct as written; this session did not touch it.

### Deviation from the addendum's suggested seeding approach

The addendum offered two options for seeding a non-`'todo'` status: an
optional `status` parameter on `seedFixture`, or a follow-up admin-client
`update` after it runs. Took the second — `seedFixture`'s signature (and
therefore `beforeEach`, which every other test in the file shares) stays
untouched, so this addendum's diff is confined to new test bodies rather
than touching shared fixture code the other two tests depend on. `liked`
and `attended` are decided at submit time from the community row's current
state, not from whatever the page loaded with, so updating the status any
time before clicking Submit is equivalent to seeding it that way from the
start.

## How to test this by hand

1. `npm run build && npm run start` (a real production server, not `next
   dev`).
2. `npx playwright test e2e/evaluations.spec.ts --reporter=list` against
   that server, with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `E2E_USER_ID` set (as in `.env.local`).
3. Expect 4 passed: the two pre-existing tests plus
   `submitting attended+liked against a 'cut' community leaves status
   untouched but still increments times_visited` and the same for
   `'returning'`.

## Verification actually performed

Both halves of `CLAUDE.md`'s rule, live, not just `next build`:

- `npm run lint`, `npm run typecheck`, `npm run test` (599 unit tests) all
  green — untouched by this change, run to confirm no regression.
- `npm run build` succeeded.
- **A real production `next start` server** served the real authenticated
  requests: `npx playwright test e2e/evaluations.spec.ts` — 4/4 passed,
  including both new cases, each one's final assertion read back from the
  admin client, not inferred from the UI.
- The full `npm run test:e2e` suite was also run against that same server
  as a regression check: 20 passed, 1 failed, 1 skipped — both the failure
  (`e2e/settings-push.spec.ts`'s real-subscribe test) and the skip (the cron
  route's positive path) are the same two pre-existing, already-documented
  gaps `STATUS.md`'s "Waiting on Eric" section already names (Chromium's
  Push API restriction; `CRON_SECRET` not yet set) — unrelated to this
  addendum and explicitly out of its scope. No new failures.

## What I was unsure about

Nothing — the addendum was unambiguous about what to build, what not to
touch, and how to verify it. The one judgment call (update-after-seed vs.
an optional `seedFixture` parameter) was left to the builder's discretion by
the addendum itself and is recorded above.

## What the next spec needs

Nothing from this addendum. `REVIEW-FLAGS.md`'s remaining seven findings are
all `note`s, already resolved as non-actionable by the manager (see the
addendum's own "Out of scope" section) — spec 10 (crm) is next, already
drafted at `docs/specs/10-crm.md`.
