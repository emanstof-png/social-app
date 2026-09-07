# REVIEW — spec 05 addendum, duplicate organizations under naming variants

Built 2026-09-07 from `docs/specs/05-duplicate-names-addendum.md`. Tag
`spec-05-dedupe`. This is the addendum only — item 0 of the spec 06 session.
**Spec 06 was not drafted, not started, and nothing here touches calendars or
events.**

No migration. No new dependency. Four files changed.

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

**3. Precedence.** Name key first, website key second, otherwise insert. When
the two point at different stored rows the name match wins and the disagreement
is recorded on a new `MergePlan.ambiguous`, surfaced by `round.ts` as an
`AMBIGUOUS` line and by `scripts/discover.ts` as a `?` line.

**4. An existing row is never renamed.** `name` was already absent from
`WRITABLE` and stays absent. A test now pins it, because the broader key makes a
differently-named row reachable for the first time.

Thirteen new tests, all written red before green: six for the name key (5 failed
first, 1 was a negative case that had to stay green) and seven for the website
key (5 failed first, 2 negative). The whole suite is 450 passing, 4 skipped.

### Files touched

| File | Change |
| --- | --- |
| `lib/discovery/research.ts` | `matchKey`, `byWebsite`, precedence, `ambiguous` on `MergePlan` |
| `lib/discovery/round.ts` | two empty-plan literals, `AMBIGUOUS` log line |
| `scripts/discover.ts` | dry-run reporting of ambiguities |
| `tests/discovery.test.ts` | two new describe blocks |

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

**2. The merge against your real stored communities, writing nothing.**

```
npm run discover -- --dry-run --activity "Contra dance" --location "Arlington, VA" --rounds 1 --user e868f1f2-0442-4805-9a1a-f78cb494126b
```

It prints `Read 9 stored communities for this activity` and then a
`WOULD WRITE:` block. What to look for: the two FSGW rows now produce a single
`~ Folklore Society of Greater Washington (FSGW)` update rather than two, and
several `- ... : Already found earlier in this same round.` lines. Nothing
reaches Supabase; the last line says so.

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

**1. The addendum's own first pair is not fixed, and spec 07 should know.** The
two known duplicates behave differently:

| Pair | Name key | Website key | Result |
| --- | --- | --- | --- |
| "FSGW" / "The FSGW" | collapses | n/a | **fixed** |
| "Silver Spring Contra Dance" / "FSGW – Silver Spring Contra Dance" | no match | no match | **not fixed** |

The second pair's websites are `https://fsgw.org/silver-spring-contra-dance` and
`https://www.fsgw.org/silver-spring-contra-dance`. `normalizeUrl` lowercases the
host but does not strip `www.`, so those are two keys. The names do not match
either, because there is deliberately no substring containment. A future run can
therefore still produce this shape of duplicate.

Stripping `www.` in `normalizeUrl` would fix it, and would also change how the
search chain dedupes hits, which is a different subsystem with its own tests. I
did not make that change unasked. **This is the one decision I would put back to
you before spec 07.**

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
  there.
- **Decide the `www.` question** in "What I was unsure about" #1 before spec 07,
  since it decides whether the pair can come back.
- **Spec 06 is untouched and undrafted.** It still starts where spec 05 left it:
  `communities.calendar_url` populated, `calendar_kind` always null,
  `event_extraction` still on its spec 02 stub prompt, and `lib/discovery/fetch.ts`
  with robots.txt already honoured to reuse rather than rebuild. Read
  `docs/specs/06-scheduled-jobs-addendum.md` when drafting it.
- `MergePlan` has a fourth field now. Anything in spec 06 that builds a plan
  literal needs `ambiguous: []`, and `tsc` will say so.
