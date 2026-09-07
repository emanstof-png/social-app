# CONVENTIONS — how gazelle's code is shaped

The code schema. Every spec from 06 onward cites this file rather than restating
it: a scope item says "per `docs/CONVENTIONS.md#page-layout`" and spells out
only where it deviates.

This is not `CLAUDE.md`. That file holds the non-negotiable rules for a build
session: checkpoint discipline, the hard rules, and what "verified" means. This
file describes the shape the code already has, so a new spec copies it instead
of re-deriving it. Where the two touch, `CLAUDE.md` wins and this file links to
it rather than repeating it.

Every convention below names at least one file that exists in the repo today. A
spec that needs a pattern this file does not cover adds it here as a numbered
scope item of that spec, so the schema grows in one file rather than being
re-derived per spec.

## Page layout

A route under `app/(app)/<route>/` splits five ways: `page.tsx` is a thin server
component that reads the user, runs the onboarding gates and hands off;
`data.ts` holds the reads and is server-only; `actions.ts` is `"use server"` and
may export async functions only, which is why shared reads cannot live there;
`view.ts` holds pure view helpers and label maps with no directive; and each
`"use client"` component sits in its own file. Established in spec 04
(`app/(app)/activities/`) and repeated in spec 05 (`app/(app)/communities/`),
both with the same five files.

A gate renders a plain explanation and a link, not a redirect the user cannot
account for: see the `Gate` helper at the bottom of
`app/(app)/communities/page.tsx`. A read that throws is caught and its real
message rendered, rather than an empty page.

**Pre-convention:** `app/(app)/assessment/` (spec 03) has `actions.ts` and
`view.ts` but no `data.ts`, and `app/(app)/settings/` (spec 02) has neither
`data.ts` nor `view.ts`. Copy the spec 04/05 shape, not those two.

## Directive-free shared modules

Any constant, catalogue or type imported by both client and server code lives in
a file with no `"use client"` and no `"use server"` directive. This is a
`CLAUDE.md` hard rule and the reason is there: across a client boundary the
server receives a client-reference proxy rather than the real value, and array
methods on it fail silently in production only.

Examples, each carrying a banner comment saying why: `app/(app)/nav-items.ts`,
`lib/llm/catalog.ts`, `lib/search/catalog.ts`, `lib/discovery/budget.ts`,
`app/(app)/communities/view.ts`.

`tests/client-boundary.test.ts` enforces the rule, but note its scope: it walks
`app/` only and asserts that a `"use client"` module exports components alone.
The catalogues under `lib/` follow the same rule by convention and by comment,
not because that test checks them.

## Pure core, server edge

A `lib/<domain>/` module is pure: no Supabase client, no `fetch`, no
`process.env` inside it. The impure edges live in a sibling `*-server.ts` that
wires them. Three pairs exist: `lib/llm/gateway.ts` and `gateway-server.ts`,
`lib/search/chain.ts` and `chain-server.ts`, `lib/discovery/round.ts` and
`round-server.ts`.

Every `*-server.ts` opens with an explicit banner: "Server-only. Never import
this from a `"use client"` module." `lib/search/credentials.ts` carries the same
banner for the same reason.

A domain small enough not to need its own wiring skips the sibling and lets the
route's `actions.ts` do it: `lib/activities/plan.ts` and
`lib/assessments/flow.ts` are pure with no `-server.ts`, and
`app/(app)/activities/actions.ts` supplies the Supabase client.

## Dependency injection

Impure edges arrive as a single deps object, so a unit test drives the real
logic with no network and no database. `GatewayDeps` (`lib/llm/gateway.ts`,
built by `serverGatewayDeps`), `SearchDeps` (built by `searchDepsFor` in
`lib/search/chain-server.ts`) and `RoundDeps` (built by `roundDepsFor` in
`lib/discovery/round-server.ts`) are the three.

This is also what makes a dry run honest rather than a second code path:
`scripts/discover.ts` builds the same `RoundDeps` with the write functions
replaced, so `--dry-run` runs the real loop and writes nothing.

## Workflow engines are reducers

A multi-step process keeps its state in the database and exposes a pure
`nextStep(state)` that says what happens next and why. `nextStep` in
`lib/discovery/research.ts` returns `{ step, why }`, and the `why` is not
decoration: it is what the Communities page shows when a run stops.
`lib/assessments/flow.ts` is the same idea without a state row, deriving the
interview's position from the stored `assessment_answers` rows alone.

When a full run would exceed a serverless function's time limit, one step per
request. Spec 05 advances a discovery run by one round per request and persists
to `discovery_runs`, which is what makes an interrupted run resumable rather
than lost. Budget checks come before phase checks in `nextStep`, so a run cannot
slip past a hard stop by being mid-round.

## LLM components

One file per component under `lib/llm/components/`, exporting a
`ComponentDefinition` (`lib/llm/component.ts`): `id`, `inputSchema`,
`outputSchema`, `systemPrompt`, `buildMessages`, `sampleInput`,
`maxOutputTokens`, `temperature`. `lib/llm/components/discovery-extraction.ts`
is the model to copy.

Registration is in two places and both are exhaustive `Record<LlmComponent, …>`
types, so adding a label to the enum without defining the component is a compile
error: `COMPONENT_REGISTRY` in `lib/llm/components/index.ts` and
`DEFAULT_MODEL_SETTINGS` in `lib/llm/catalog.ts`. `COMPONENTS` in the same
catalogue is a readonly array of dropdown metadata, not a Record, and needs its
own entry.

Every new component states its default model **and the reasoning**, in a comment
on its `DEFAULT_MODEL_SETTINGS` entry. The two discovery components are the
worked example: the reliable model where reasoning decides the outcome, the
high-volume free model where the job is reading a page, and a note saying what
to try first if quality turns out poor.

No component calls a provider directly. Every call goes through the gateway,
which resolves the model, validates the output, retries once and logs.

## Zod row schemas

One file per table area under `lib/schemas/`, re-exported from
`lib/schemas/index.ts`. Each table exposes a `…Row` schema (what the database
returns) and a `…Insert` schema (what the app writes); tables the user edits
also expose `…Update`. `lib/schemas/search.ts` is the model to copy. Enum labels
live in `lib/schemas/enums.ts` and mirror `supabase/migrations/0001_enums.sql`.

`tests/migration-sql.ts` replays every migration in filename order, including
`alter table … add column` and `alter type … add value`, and
`tests/schemas.test.ts` fails if a table or an enum label has no matching Zod
schema. A new table therefore means a new schema file and an `index.ts` entry in
the same scope item, or the suite goes red.

## Migrations

Sequential `NNNN_<name>.sql` under `supabase/migrations/`, currently 0001
through 0010, applied to Supabase project `wqawpwbgrsjusbdopgbi`.

Enum changes and the tables that use them go in **separate files**: Postgres
cannot use a newly added enum label in the transaction that adds it, and each
Supabase migration file runs in one transaction. `0008_discovery_enums.sql` and
`0009_discovery_tables.sql` are the pair that shows it.

RLS goes in the same file as the table it protects (`0009` writes its own
policies in a `do` block, the same shape as `0003_rls.sql`). User-content and
audit tables get select, insert and update and **no delete policy**. A table
with an `updated_at` gets the `set_updated_at` trigger. Index the hot lookup,
and use a partial index when the query is narrow:
`discovery_runs_user_open_idx … where status = 'running'`.

## Log tables

Every model call writes exactly one `run_log` row, win or lose, and the gateway
does it so no caller can forget (`writeRunLog` in `lib/llm/gateway-server.ts`).
Every search API call writes one `search_log` row including the fall-throughs,
so a fall-through is a record rather than something inferred from a gap. Every
run of a multi-step job writes a row with honest counts and a status enum:
`discovery_runs`, where `empty` is deliberately distinct from `complete` and
from `failed`.

Failures carry an `error_kind` and the real provider message. `search_log`
reuses `run_status` and `run_error_kind` from migration 0005 rather than
declaring near-identical enums. Nothing is swallowed: a failure stops its item,
logs, and surfaces the real message in the UI with a Retry control.

## Idempotent writes

Write through the unique index, not around it: `communities_user_name_key` and
`activities_user_name_key` are both `(user_id, lower(btrim(name)))`. A name
already present is an update, never an insert, and the update carries only the
fields that actually differ, so running twice over the same findings produces
zero writes the second time. `mergeFindings` in `lib/discovery/research.ts` is
the reference implementation, with its `WRITABLE` list and its structural
`sameValue` comparison.

An app-side match key may be **broader** than the index and never narrower.
`matchKey` matches more names than `nameKey` does, which turns an insert the
index would have rejected into an update; a narrower key would instead produce
insert failures.

Never touch a user-owned field. Where a discovered field is also user-editable,
protect it with a `*_edited_by_user` flag (`activities.kind_edited_by_user`,
migration 0007, added after a re-run silently destroyed an edit). Better, keep
discovered facts and user opinions in disjoint columns, as spec 05 does, and no
flag is needed.

## Status over delete

Removal is a status transition, never a delete. `CLAUDE.md` states the rule and
RLS backs it: `0003_rls.sql` grants no delete on communities, events or
contacts, and `0009` grants none on `discovery_runs` or `search_log`. An
archived row is shown apart and can be restored, as `partitionByArchived` in
`app/(app)/communities/view.ts` does.

## Settings is the operator surface

Each subsystem adds a read-only section to `/settings` showing its configuration
state, plus a view over its log table. `app/(app)/settings/` currently holds
`provider-keys.tsx`, `model-settings.tsx`, `run-log.tsx`, `search-providers.tsx`
and `search-log.tsx`.

A configuration section renders booleans. It never renders, echoes or logs key
material, and where a key comes from the environment there is no input to paste
one into: `searchProviderStatus()` in `lib/search/credentials.ts` returns
configured-or-not, the env var name and a signup link, and nothing else.

## Environment variables

Read in one place per subsystem and reported as booleans.
`lib/search/credentials.ts` is the whole of it for search;
`resolveCredentialsFor` in `lib/llm/gateway-server.ts` is the model equivalent,
where a key stored in `provider_keys` wins over the environment variable and the
environment is the fallback. A variable set to the empty string counts as
absent, so the chain skips the provider instead of sending an empty header and
reporting the 401 as a provider failure.

Every new variable gets a line in `docs/ARCHITECTURE.md` under Environment,
saying where it goes: `.env.local`, Vercel (Production and Preview), GitHub
repository secrets, or some combination. Secrets never appear in code and
`.env.local` is gitignored.

## Tests

Vitest under `tests/`, one `<module>.test.ts` per module, red before green,
never edited to go green. No network in a unit test: fixtures live under
`tests/fixtures/<domain>/`, as `tests/fixtures/search/` holds one recorded
response per provider. Live suites skip themselves unless a flag is set, so CI
spends no API quota (`tests/live-gateway.test.ts`, and the note in
`.github/workflows/ci.yml`).

Playwright suites live under `e2e/` and run against `next build` + `next start`,
never the dev server (`npm run test:e2e`, `playwright.config.ts`). CI runs
`npm run lint`, `npm run typecheck` and `npm test` on every push, then the
Playwright job under the four repository secrets, skipping cleanly and green if
they are absent so a fork still builds.

## Scripts

`scripts/<name>.ts`, run through `tsx` with an npm alias:
`"discover": "tsx --env-file=.env.local scripts/discover.ts"`. Anything that
would write supports `--dry-run` with the full logic and no writes, built first,
and the run says in its last line that nothing reached the database.

## Naming

`snake_case` in Postgres, for columns and for enum labels. `camelCase` in
TypeScript. `kebab-case` file names (`discovery-extraction.ts`,
`round-server.ts`, `search-providers.tsx`). Route directories are lowercase and
match their URL segment.

## Docs touched by every spec

`CHANGELOG.md` gets one line, newest first. `STATUS.md` moves the spec's state
and records anything a later session would otherwise re-derive.
`docs/BUILD_PHASES.md` records the actual build order. `docs/ARCHITECTURE.md`
changes when environment variables, tables or subsystems do. `REVIEW.md` at the
repo root is overwritten per `CLAUDE.md`, and the spec is tagged `spec-NN` at
the end; an addendum built on its own gets its own tag, as `spec-05-dedupe` did.

## Proposed, not yet adopted

Visible so it is not re-argued, not binding on any spec.

- **`data.ts` in every route.** `/assessment` and `/settings` predate the split
  and keep their reads elsewhere. Worth doing when one of them is next touched,
  not as its own spec.
- **Extend `tests/client-boundary.test.ts` to `lib/`.** The directive-free
  catalogues under `lib/` are convention and comment only; the test that would
  catch a regression walks `app/` alone.
- **A fixtures directory per domain.** Only `tests/fixtures/search/` exists; the
  discovery tests build their inputs inline.
- **A cross-run zero-write merge.** `discovery_run_id` is in `WRITABLE`, so a
  second run over identical findings writes that one field on every matched row.
  Harmless today and noted in `STATUS.md`; revisit only if a spec needs the
  column to mean "the run that first found this".
