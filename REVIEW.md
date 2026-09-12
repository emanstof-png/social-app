# Review — spec 10 (CRM)

Built by the loop from `docs/specs/10-crm.md` (no addendum). All eight scope
items finished; nothing High-tier was hit.

## What was built

1. **`/people` reads and the gated page.** `app/(app)/people/data.ts` follows
   the spec 04/05 five-file page shape and reuses `../feed/data.ts`'s
   `readEvents`/`readCommunitiesById`/`readSelections` and
   `../communities/data.ts`'s `readCommunities` directly — no second query
   against those tables. `readMeetableEvents` reads `readSelections`'s own
   rows for `status: 'attended'`, dedupes by `event_id` and keeps the most
   recent occurrence, rather than re-expanding recurrence through
   `expandOccurrences`: a contact's `met_at_event_id` references an event,
   not a specific occurrence, and `expandOccurrences`'s own
   `MAX_OCCURRENCES_PER_EVENT` cap (walked forward from an event's own
   `starts_at`) would have silently dropped an attendance far enough into a
   long-running recurring event's history if a wide `[epoch, year 9999]`
   window had been used with it instead. `/people` gates on
   `hasSelectedActivities`, same reasoning every other post-onboarding page
   already uses.
2. **Add, edit and archive a contact.** `createContact` validates against
   `contactInsert` and, in the same call, inserts exactly one founding
   `'met'` interaction (`occurred_at: met_on ?? now()`, `event_id:
   met_at_event_id ?? null`). `updateContact` mirrors `updateCommunity`'s
   exact per-field patch shape, reusing `contactUpdate` for validation.
   `archiveContact`/`restoreContact` flip `status` — `contacts` has no delete
   grant in RLS, so this is the only way a contact leaves the active list.
   The People page renders an Add-contact form, per-field autosave with the
   established "✓ Saved" badge, and an Active/Archived split
   (`people/view.ts#partitionByStatus`, kept local rather than importing
   `communities/view.ts`'s version, per the existing convention that every
   route's `view.ts` stays self-contained).
3. **Interaction logging and tallies.** `logInteraction`'s own input schema
   accepts only `'text' | 'invite' | 'hangout'` — narrower than the
   `interaction_kind` column — since `'met'` is written in exactly one place
   (`createContact`) and letting it be logged again here would double-count
   a relationship's founding interaction. An optional `eventId` is checked
   against `readMeetableEvents`'s own list. `people/view.ts#tally` counts
   live from `interactions` on every read, never a stored counter, honoring
   the table's own migration comment ("Tallies... are derived from these
   rows, never stored as a counter").
4. **Compose and send via phone.** A fixed, non-LLM template
   (`composeTemplate`) behind `sms:`/`mailto:` links, never a send API
   (CLAUDE.md's hard rule: the app only prepares, the user sends). A manual,
   undetected-by-design "✓ I sent this" button logs a `'text'` interaction
   at the moment it's clicked — there's no way for this page to know whether
   the native app that opened was actually used to send.
5. **vCard/CSV parsers.** `lib/crm/import.ts`, pure, hand-rolled — the same
   call `lib/scraping/ics.ts` made for RFC 5545 rather than adding a
   dependency. A vCard block with no `FN`, or a CSV row with a blank name,
   is skipped with a warning naming its position; a CSV with no `name`
   column is rejected up front. `tests/crm-import.test.ts`, 10 cases, red
   before green.
6. **Import preview and write.** `previewImport` parses only and writes
   nothing; it flags a likely duplicate against the caller's existing
   contacts by `lower(btrim(name))` (`contactNameKey`) so the review screen
   can warn without silently skipping or silently double-adding.
   `importContacts` calls `createContact` once per checked row — the same
   write path item 2 built, not a second implementation — with `met_on`
   always null (an import has no real meeting date to invent).
7. **Recall and search.** `people/view.ts#matchesQuery`, a pure client-side
   filter over the page's own already-loaded contact list (name, phone,
   email, notes, met-at community/event name) — no new server round trip.
   `tests/people-view.test.ts`, 8 cases.
8. **Docs.** `docs/ARCHITECTURE.md` gained a "CRM (spec 10)" section;
   `CHANGELOG.md` and `STATUS.md` updated; this file.

## A real bug found live, not by the unit suite

The import review panel called `onDone()` (closing itself) in the same
render tick as `setResult(outcome)` (showing "Imported N contacts"), so the
confirmation was computed but never actually seen — the component unmounted
before the browser painted it. This is the same unmount-before-render class
of bug specs 04, 07 and 09 each hit exactly once, each time only caught by
the required live e2e run against a real production server, never by
`next build` or the unit suite. Fixed in
`app/(app)/people/people-view.tsx#ImportPanel.confirmImport`: success no
longer auto-closes the panel — it clears the review checklist and leaves the
confirmation on screen until the person dismisses it via "Cancel import"
themselves.

## The viral/k-factor addition note

`docs/specs/10-crm-addition-note.md` (shareable event page, one-tap account
creation, share-sheet invite scripts, "N friends going" social proof) was
read during drafting and deliberately **not** folded into this spec's scope.
The note itself asks for exactly this — that a session with no live planning
chat available should flag it rather than build it unilaterally or drop it
silently — because it raises real, unresolved product and privacy questions
(an unauthenticated page, a new account-creation path, what "N friends
going" reveals about a private list). It stays fully out of scope; whoever
runs the next review gate should read it and decide whether/how a future
spec picks it up.

## How to test this by hand

1. `npm run dev` (or `next build && next start`), sign in, and visit
   `/people`. If gated, finish onboarding through `activities_selected`
   first (assessment, then pick a focus activity on `/activities`).
2. Click **Add contact**, type only a name, submit. The contact appears in
   the active list immediately. Expand its card — the History section
   shows one "Met" entry.
3. Expand a contact and edit **Notes** (blur to save). A "✓ Saved" badge
   flashes next to Notes only; no other field changes.
4. Click **Archive** on a contact. It disappears from the active list and
   reappears under the "N archived" `<details>` section with a **Restore**
   button.
5. Expand a contact, use **Log an interaction** (pick a kind, a date,
   optionally an event), click **Log**. The card's header count and the
   History list both update without a manual page reload.
6. Expand a contact with a phone/email on file. The **Message** panel shows
   a prefilled draft; the **Text**/**Email** links' `href` carries the
   drafted text URL-encoded. Click **✓ I sent this** twice — two `'text'`
   interactions appear in History.
7. Click **Import vCard/CSV**, choose a small `.vcf` or `.csv` file (a phone
   Contacts app's own "Export vCard," or a spreadsheet's CSV export both
   work). The review screen lists every parsed row, checked by default,
   with warnings for anything unparseable and a "Likely duplicate" tag for
   a name that already exists. Uncheck rows you don't want, click
   **Import N contacts**; the confirmation stays on screen until you close
   the panel yourself.
8. Type into the search box at the top — the list narrows immediately, with
   no loading state (there is no server round trip).

## What I was unsure about

- Whether `readMeetableEvents` should list every distinct **occurrence** a
  user attended of a recurring event, or dedupe to one entry per **event**.
  Went with one-per-event (keeping the most recent attended occurrence),
  because `contacts.met_at_event_id` is a plain event reference with no
  occurrence column — there is nowhere on the contact row to store which
  specific occurrence someone was met at, so offering occurrence-level
  granularity in the dropdown would have been a distinction the schema
  can't actually record.
- The compose template's wording is a single fixed sentence
  (`composeTemplate` in `people/view.ts`). The spec only asks for "a plain
  template," not specific copy, so this is a placeholder tone choice, not a
  product decision — easy to change later without touching any write path.

## What spec 11 needs

- `invite_suggestions` and the real `invite_suggestion` LLM component prompt
  are still spec 11's, untouched here. `readMeetableEvents` in
  `app/(app)/people/data.ts` is available to reuse for "who was at this
  event" style logic if spec 11 needs it.
- The viral/k-factor addition note above is still unscoped and unbuilt —
  worth a decision at this review gate before spec 11 starts, since spec 11
  is the next PRD-numbered CRM-adjacent spec (§4.4/4.6) and the two could
  otherwise collide in scope.
- `docs/specs/dojo-and-practice-layer-note.md` (flagged in `STATUS.md` since
  before spec 09) is still unread against spec 11 as of this session.

## Verification actually performed

Both halves of the CLAUDE.md rule, not just `next build`:

- `next build` passed. `npm run lint`, `npm run typecheck`, and `npm test`
  (635 unit tests, including this spec's 18 new ones) all green.
- A real production `next start` server served real authenticated requests:
  `npx playwright test e2e/people.spec.ts` — **8/8 passed** — exercising add
  (with the founding interaction verified via the admin client), per-field
  edit isolation, archive/restore, interaction-tally freshness after a real
  server round trip (not a stale cached count), the compose panel's actual
  `href` attributes plus two real confirm-send writes, vCard import (two
  valid contacts, one missing-`FN` block, both preview and write verified
  against the real database), CSV import with a real duplicate-name flag,
  and the search filter (verified to fire zero same-origin `POST` requests
  while typing). The vCard/CSV steps drove a real browser
  `<input type="file">` via Playwright's `setInputFiles`, not a stub or a
  direct function call.
- The full `npm run test:e2e` suite was run as a regression check:
  **27 passed, 1 failed, 1 skipped.** The failure
  (`e2e/settings-push.spec.ts`) and the skip (the cron route's positive
  path) are the same two pre-existing, already-documented gaps under
  `STATUS.md`'s Waiting on Eric section (Playwright's bundled Chromium has
  no working Push API; `CRON_SECRET` is not yet set) — both predate this
  spec and are unrelated to it. No new failures.

Review gate: open your planning chat and paste REVIEW.md.
