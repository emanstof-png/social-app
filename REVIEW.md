# REVIEW — spec 05 addendum, duplicate organizations under naming variants

Built 2026-09-07 from `docs/specs/05-duplicate-names-addendum.md`. Tag
`spec-05-dedupe`. This is the addendum only — item 0 of the spec 06 session.
**Spec 06 was not drafted, not started, and nothing here touches calendars or
events.**

**Corrected at the review gate**, the same way spec 04 was by migration 0007:
`normalizeUrl` now strips a leading `www.`, which fixes the one pair the first
pass left broken. Both original deviations were accepted as built.

No migration. No new dependency. Six files changed.

---

## What was built

Both changes the addendum specifies, one at a time with a checkpoint between.

**1. A broader match key.** `matchKey` in `lib/discovery/research.ts`, beside
the unchanged `nameKey`. On top of `lower(btrim(name))` it strips a leading
`the `, strips a trailing parenthetical acronym, and collapses separator
punctuation (`–`, `—`, `-`, `:`) and runs of whitespace to single spaces.
`mergeFindings` uses it for lookup and for the same-round guard.

`nameKey` is untouched and still documents exactly what
`communities_user_name_key` enforces. The app-side key is broader than the index
and never narrower, which is safe in that direction only: matching more names
than the index does turns an insert the index would have rejected into an
update, whereas a narrower key would produce insert failures.

**2. A second key on the website.** A `byWebsite` map on
`normalizeUrl(website)` from `lib/search/chain.ts`, skipping null websites.
Full URL, never the host, so two dances under one parent society's site stay two
rows.

**2a. `normalizeUrl` strips a leading `www.` (review-gate correction).** `www`
is conventionally an alias for the bare host, and keeping the two apart is what
let `fsgw.org/silver-spring-contra-dance` and
`www.fsgw.org/silver-spring-contra-dance` become two rows for one dance. Only
the exact `www.` label goes; `www2.` and `wwwifications.` are ordinary hosts and
stay whole. This is a change to the shared search-chain key, so the search
chain's own hit dedupe now also treats www and non-www as one page — a
correctness gain there too, and it means the loop no longer reads that page
twice.

**3. Precedence.** Name key first, website key second, otherwise insert. When
the two point at different stored rows the name match wins and the disagreement
is recorded on a new `MergePlan.ambiguous`, surfaced by `round.ts` as an
`AMBIGUOUS` line and by `scripts/discover.ts` as a `?` line.

**4. An existing row is never renamed.** `name` was already absent from
`WRITABLE` and stays absent. A test now pins it, because the broader key makes a
differently-named row reachable for the first time.

Seventeen new tests, all written red before green: six for the name key (5
failed first, 1 a negative case that had to stay green), eight for the website
key including the gate's Silver Spring case, and three for `normalizeUrl` and
`dedupeHits`. The whole suite is 454 passing, 4 skipped.

**Two pre-existing assertions in `tests/search-chain.test.ts` changed**, and you
should know which: `lowercases the host and drops the fragment` and `keeps the
path's case` both carried a `www.` through their expected string, so they
asserted exactly the behaviour the gate reversed. Each still asserts its own
subject — host lowercasing, and path case surviving — and neither was weakened
to go green; only the host in the expected value changed. There is a comment
above them saying so. No other test was touched.

### Files touched

| File | Change |
| --- | --- |
| `lib/discovery/research.ts` | `matchKey`, `byWebsite`, precedence, `ambiguous` on `MergePlan` |
| `lib/search/chain.ts` | `normalizeUrl` strips a leading `www.` (gate correction) |
| `lib/discovery/round.ts` | two empty-plan literals, `AMBIGUOUS` log line |
| `scripts/discover.ts` | dry-run reporting of ambiguities |
| `tests/discovery.test.ts` | two new describe blocks |
| `tests/search-chain.test.ts` | www cases, and the two assertions above |

---

## How to test it by hand

**1. The unit tests, which are the real specification here.**

```
npm test
```

450 passing, 4 skipped. To see only the new ones:

```
npx vitest run tests/discovery.test.ts -t "match key"
npx vitest run tests/discovery.test.ts -t "website key"
```

**2. The whole loop against the real APIs, writing nothing.**

```
npm run discover -- --dry-run --activity "Contra dance" --location "Arlington, VA" --rounds 1
```

Ends in a `WOULD WRITE:` block, with `- ... : Already found earlier in this same
round.` lines where two findings turned out to be one organization. Nothing
reaches Supabase; the last line says so.

Adding `--user e868f1f2-0442-4805-9a1a-f78cb494126b` is meant to merge against
your stored rows and print `Read 9 stored communities for this activity` first.
**It currently prints no such line and merges against an empty list**, because
those 9 rows were orphaned from their activity while verifying the first pass.
See "Verified" below; it is repairable with two SQL statements.

**3. The page, under a real production session.**

```
npm run build
npm start
```

Then sign in at http://localhost:3000/login with a magic link and open
**/communities**. The nine cards render with their source links, and status,
focus and notes are still yours to edit. Nothing about this page changed; it is
here because CLAUDE.md's rule is that a production server has to serve a real
authenticated request before anything is called verified.

**4. What you still have to do by hand.** In `/communities`, set one of each
duplicate pair to **archived**:

- keep one of "Folklore Society of Greater Washington (FSGW)" and "The Folklore
  Society of Greater Washington (FSGW)"
- keep one of "Silver Spring Contra Dance" and "Folklore Society of Greater
  Washington (FSGW) – Silver Spring Contra Dance"

RLS grants no delete on `communities`, by design, and this change stops new
duplicates rather than merging the ones already written.

---

## Verified

Per the CLAUDE.md rule, **both halves — but the merge path and the page were
verified separately, and you should know which is which.**

- `next build` passed.
- A production server (`npx next start`, not the dev server) served a **real
  authenticated request**: an admin-minted magic link through the app's own
  `/auth/callback`, then `GET /communities` returning **200** with 45KB of HTML
  containing the real community names and no signed-out marker.
- The committed e2e suite (4 tests, login + assessment) passes against that same
  production server.
- **The merge logic itself was exercised by the dry run, not by the page.**
  `npm run discover -- --dry-run --user ...` ran against the 9 real stored
  communities with real search keys and real models. It collapsed the two FSGW
  rows into one update instead of two, and dropped four same-round duplicates.

**No writing discovery run was triggered.** The dry run showed that a real run
would insert "Silver Spring Contra Dance (FSGW-sponsored)" as a new row — a
fresh near-duplicate — into the table you are about to hand-clean. Writing that
and then asking you to archive it seemed worse than saying so here. If you want
the write path exercised before spec 06, click **Discover** on `/communities`
once after archiving, and expect to archive one more row.

### The gate correction, and one thing I broke while verifying the first pass

The `www.` change was verified against your 9 stored communities read-only,
because the full dry run can no longer reach them:

- **Running the committed e2e suite deleted the "Contra dance" activity row.**
  `e2e/assessment.spec.ts` calls `resetUser`, which deletes `activities`,
  `assessments` and `assessment_answers` for the e2e user — by design, the suite
  owns that account. But the 9 communities hang off that activity, and
  `communities.activity_id` is `ON DELETE SET NULL`, so **all 9 are now
  orphaned with `activity_id = null`.** The rows and their names, websites and
  source URLs are intact; only the link is gone. This happened during the first
  pass's verification, before the gate.
- `npm run discover --dry-run --user ...` finds communities *through* the
  activity, so it now reports no matching activity and merges against an empty
  list. That is why the re-run you asked for could not be the proof on its own.
- Restoring the link needs two writes to Supabase (re-insert the activity, point
  the 9 rows back at it). **I was blocked from making them and did not work
  around it** — say the word and I will, or do it from the SQL editor.
- Instead the claim was verified directly against the same rows, read-only:
  `mergeFindings` was handed all 9 stored communities and the exact finding that
  produced the duplicate. Result above — 0 inserts, one update, ambiguity
  reported. This is a narrower check than a full dry run, and it is the specific
  claim the gate asked about.

**Worth deciding before spec 06:** the e2e suite and the discovery data now
share one account, so running the tests damages the discovery fixtures. Either
give the e2e suite its own user, or add `communities` to `resetUser`, or accept
that `/communities` data on that account is disposable.

---

## Where I deviated, and why

**1. `MergePlan.ambiguous` is a new field, not a `dropped` entry.** The addendum
says to log the ambiguity "in the round's skip reasons". `dropped` is literally
the not-written list, and `round.ts` prints it as `DROPPED <name>: <reason>`, so
putting an ambiguity there would print a line saying a community was dropped on
the same pass that writes it. A false log line is worse than a new field. This
is the only reason `round.ts` and `scripts/discover.ts` are in the file list.

**2. The same-round guard checks the website key too.** The addendum's
precedence rule describes matching a finding against *stored* rows and says
nothing about two findings inside one round. Applying only the name key there
leaves a hole: one round can insert two different names that share a URL, which
is the duplicate the addendum exists to prevent. The real dry run hit this —
"Dancing Planet Contra Dance" and "Dancing Planet Contra Dance (FSGW-sponsored)"
were collapsed by the website key, not the name key — so it is reachable, not
theoretical. It is one `Set` and one test if you want it reverted.

---

## What I was unsure about

**1. Both known pairs are now handled — this was the gate's correction.** Both
are covered, by different keys:

| Pair | Name key | Website key | Result |
| --- | --- | --- | --- |
| "FSGW" / "The FSGW" | collapses | n/a | **fixed** (first pass) |
| "Silver Spring Contra Dance" / "FSGW – Silver Spring Contra Dance" | no match | collapses once `www.` is stripped | **fixed** (gate correction) |

The second pair's websites are `https://fsgw.org/silver-spring-contra-dance` and
`https://www.fsgw.org/silver-spring-contra-dance`. Their names do not match and
never will, because there is deliberately no substring containment, so the
website key was the only thing that could join them — and it now does.

Confirmed against your actual stored rows, read-only: replaying the finding that
produced the duplicate now yields **0 inserts** and one update to the
name-matched row, and it reports the ambiguity by id, naming both stored rows as
possibly one organization. Before the correction that same finding inserted a
tenth row.

**2. The trailing-parenthetical rule is letters-only.** `(fsgw)` is stripped;
`(FSGW-sponsored)` and `(Arlington VA)` are not, because the addendum says
"acronym" and treating every parenthetical as noise would merge two same-named
organizations in different towns. The visible consequence is in the table above:
`Silver Spring Contra Dance (FSGW-sponsored)` stays distinct from
`Silver Spring Contra Dance`.

**3. Two stored rows collapsing to one `matchKey` — first wins.** With a broader
key, `byName` can now have a genuine collision, which `nameKey` could never
have. I made the first row win rather than the last, so the choice is stable
across runs until one of the pair is archived. The addendum does not say which,
and it stops mattering once the duplicates above are archived.

**4. Names the key still does not join.** `Friday Night Dancers` and
`Friday Night Dancers, Inc.` are two rows with two different websites. Commas
and legal suffixes are not in the addendum's list and I did not add them.

---

## What the next spec needs

- **Archive the duplicate rows first** (section 4 of "How to test it by hand").
  Spec 07 attaching event streams to both halves of a pair is the failure the
  addendum was written to prevent, and code alone cannot undo the rows already
  there. Discovery will now *tell* you about this pair, on an `AMBIGUOUS` line,
  every round until one of them is archived.
- **Decide the shared-account question** in "Verified" above: the e2e suite
  deletes the activity the discovery fixtures hang off, and the 9 communities
  are currently orphaned.
- **Spec 06 is untouched and undrafted.** It still starts where spec 05 left it:
  `communities.calendar_url` populated, `calendar_kind` always null,
  `event_extraction` still on its spec 02 stub prompt, and `lib/discovery/fetch.ts`
  with robots.txt already honoured to reuse rather than rebuild. Read
  `docs/specs/06-scheduled-jobs-addendum.md` when drafting it.
- `MergePlan` has a fourth field now. Anything in spec 06 that builds a plan
  literal needs `ambiguous: []`, and `tsc` will say so.
