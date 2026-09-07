# Spec 05 addendum — duplicate organizations under naming variants

Settled at the spec 05 review gate, 2026-09-07. **Build this as item 0 of the
spec 06 session, before anything touches calendars.** It is small, it is
deterministic, and it needs no new enum, table or column.

---

## The problem

Spec 05's drafting decisions assumed `communities_user_name_key` — the unique
index on `(user_id, lower(btrim(name)))` — was enough to stop two rows standing
for one real organization. The live verification run showed it is not. It wrote
both of these pairs:

- "Silver Spring Contra Dance" and "Folklore Society of Greater Washington –
  Silver Spring Contra Dance"
- "Folklore Society of Greater Washington (FSGW)" and "The Folklore Society of
  Greater Washington (FSGW)"

Each pair is one organization. The index cannot see through a naming variation,
so both rows are per spec and both are wrong. Spec 07 attaches event streams to
these rows, which turns one duplicated organization into two feeds for one
dance, so this is settled before spec 06 rather than after.

## The decision

Deterministic matching, in `mergeFindings` (`lib/discovery/research.ts`). No
fuzzy scoring, no model call, no new schema.

**1. A broader match key.** `nameKey` currently returns
`name.trim().toLowerCase()`. Add a `matchKey` that additionally:

- strips a leading `the `,
- strips a trailing parenthetical acronym, e.g. ` (fsgw)`,
- collapses internal whitespace and strips separator punctuation
  (`–`, `-`, `:`) down to single spaces.

`matchKey` is used for lookup; `nameKey` stays as the description of what the
database index enforces. **A broader app-side key is safe in that direction and
only in that direction.** Matching more names than the index does means the app
performs an update where it would otherwise have attempted an insert the index
would have rejected anyway. An app-side key *narrower* than the index would
produce insert failures, so never loosen `nameKey` itself.

**2. A second key on the normalized website URL.** When an existing row and a
finding both have a non-null `website`, compare `normalizeUrl(website)` from
`lib/search/chain.ts`. Use the **full URL, not the host**: two different dances
hosted under one parent society's site are two organizations and stay two rows.
`website` is nullable and often null, so this key is a supplement to the name
key rather than a replacement for it.

**3. Order and precedence.** Try `matchKey` first; fall back to the website key;
otherwise insert. If the two keys point at different existing rows, take the
name match and log the ambiguity in the round's skip reasons so it is visible
rather than silently resolved.

**4. An existing row is never renamed.** `name` is not in `WRITABLE` and does
not join it. The first name a run stored wins, which keeps the row stable for
anything already pointing at it.

## What this does not do

It does not merge the rows already written. RLS grants no delete on
`communities`, so the two known pairs above are cleaned up by hand in the UI by
setting one of each pair to `archived`. Do that before spec 07 attaches events.

It does not attempt fuzzy or model-based merging. A model that decides two
organizations are the same one is a design decision with its own failure mode,
and this addendum exists to remove a known duplication cheaply, not to solve
entity resolution.

## Tests, red before green

In `tests/discovery.test.ts`, alongside the existing merge cases:

- "The Folklore Society of Greater Washington (FSGW)" matches "Folklore Society
  of Greater Washington (FSGW)".
- "Folklore Society of Greater Washington – Silver Spring Contra Dance" matches
  the same name with a hyphen.
- Two genuinely different organizations under one parent site (same host,
  different paths) stay two rows.
- A website match with no name match updates rather than inserts.
- A name match and a website match pointing at different rows takes the name
  match and records the ambiguity.
- Every existing merge assertion still passes, including that no user-owned
  field is ever written.
