# REVIEW — spec 02, LLM gateway and model settings

Spec: `docs/specs/02-llm-gateway-and-model-settings.md`. Tag `spec-02`.
Date: 2026-09-06.

Also in this session, before spec 02: two orphaned planning docs were committed
(`docs/specs/12-professionalize.md`, `docs/specs/10-crm-addition-note.md`) as a
single docs-only commit, `145be68`.

---

## What was built

**1. The gateway (`lib/llm/gateway.ts`)**
The single entry point for every model call. Deterministic-first: the code owns
the workflow, the model only fills the "JSON in, JSON out" joint.

Per call it resolves the model from `model_settings`, decrypts the key from
`provider_keys` (falling back to the environment variable), calls the provider,
parses JSON out of the reply, validates it against the component's Zod output
schema, retries once with a corrective message if that fails, and writes exactly
one `run_log` row whether it succeeded or failed.

Only malformed output is retried. Auth failures, quota walls and timeouts are
not, because they fail identically the second time and would just burn a
request.

**2. Providers (`lib/llm/providers.ts`)**
One OpenAI-compatible adapter covering OpenRouter, Groq and local
(Ollama / LM Studio), plus Gemini and Anthropic adapters. No new dependencies:
all three speak plain `fetch`.

**3. Component registry (`lib/llm/components/`)**
One file per component with input schema, output schema, a stub system prompt
and a sample input. Real prompts arrive with the specs that use them.

**4. Settings page**
- Provider keys, AES-256-GCM encrypted before they reach Supabase. Plaintext
  never returns to the browser. A stored key overrides the env var.
- Per-component provider + model dropdowns with a filter box and a
  "supports tools" badge. `discovery_research` lists only tool-capable models.
- Run log: filter by component and status, cost/latency/tokens/attempts, expand
  to see input and output, and rerun on another model with the two outputs side
  by side.
- Test button (raw connectivity check) and Sample run button (full gateway run).

**5. Onboarding**
Model setup is step 1. `/assessment` shows a gate with a link to Settings until
every component has a model.

**6. Migration 0005**
`run_log` gained `provider`, `status`, `error_kind`, `error_message`,
`attempts`, `rerun_of`. Spec 01's shape could describe a successful call but not
a failed one, and both of this spec's acceptance criteria need more than that.
Applied to `wqawpwbgrsjusbdopgbi` and verified.

---

## How to test it by hand

1. `npm run dev`, open http://localhost:3000/settings while signed in.
2. **Provider keys.** OpenRouter and Gemini should show "using
   OPENROUTER_API_KEY" / "using GEMINI_API_KEY" (picked up from `.env.local`).
   The other three show "not configured". Paste any string into OpenRouter's key
   box and Save: the badge flips to "key stored". Press Remove to go back to the
   env var.
3. **Dropdowns.** Every component should already have a model (defaults are
   seeded on first load). Change Interview's model, press Save.
4. **Tool filtering.** On "Discovery research", note the "needs tool support"
   badge and that every option in its list is marked `· tools`. Other components
   list models with and without.
5. **Test.** Pick a model, press Test. It makes a real call and reports the
   latency and token counts, or the actual provider error.
6. **Sample run → acceptance criterion 1.** Press "Sample run" on Persona
   synthesis. Scroll to the run log: the newest row names the model you chose.
   Change the dropdown to a different model, Save, Sample run again: the next
   row names the new model. That is the dropdown changing which model the next
   call uses, verified in `run_log`.
7. **Acceptance criterion 3.** Expand any successful run, choose a different
   provider and model at the bottom, press "Rerun with model". The row expands
   into two panes, the original output and the rerun's, for the same input.
8. **Acceptance criterion 2.** Covered by tests rather than by hand, since it
   needs a model that returns bad JSON on demand: `tests/gateway.test.ts`
   asserts one retry then a logged error with `status: error`,
   `error_kind: schema`, `attempts: 2`. It also happened for real during this
   session, see the run log rows for `minimax/minimax-m3:free`.
9. **Onboarding gate.** Visit `/assessment`. If `onboarding_state` is still
   `new` you get the gate. Press "Model setup is done" on Settings, revisit.
10. **Tests.** `npm test` runs 105 tests. The live tests are skipped by default;
    run them with `GAZELLE_LIVE_TEST=1 npx vitest run tests/live-gateway.test.ts`
    (spends real quota, writes real `run_log` rows).

---

## Verified, and what that means

Per the CLAUDE.md rule, "verified" is not `next build` passing:

- `next build` passes, `tsc --noEmit` clean, `eslint` clean, 105 tests pass.
- **A production server was exercised under real authentication.** `next start`
  on a built bundle, signed in through the actual magic-link flow (admin
  `generate_link` → the real `/auth/callback` route → session cookie), then
  `GET /settings` returned **200** with all sections rendered, and
  `GET /assessment` returned **200** showing the gate. No 500, no
  client-boundary error.
- **The rotated keys were exercised with real API calls**, not just auth pings.
  OpenRouter and Gemini each ran `persona_synthesis` end to end and wrote a real
  `run_log` row, and a rerun linked back to its original.

---

## Two fixes made during the session

**1. The default OpenRouter model did not work.**
`z-ai/glm-5.2:free` returned 429 "temporarily rate-limited upstream" from
OpenRouter's shared free pool. The key was valid: three other free models
answered in the same second. Default moved to `minimax/minimax-m3:free`, and the
fallback list reordered by what actually answered.

**2. Prompts described no schema.**
The instruction said the reply "must match the schema described above" while
nothing in the prompt described it. Free models duly omitted required keys:
`minimax/minimax-m3:free` dropped `goals` from `persona_synthesis` on both the
first attempt and the retry. The output schema is now derived from the Zod
schema with `z.toJSONSchema()` and included in the system prompt, so the object
the model is shown is exactly the one its reply is validated against. After this
both providers succeeded on the first attempt.

Both were in-scope defects in this spec's own work, self-fixed and re-verified.

---

## What I was unsure about, and decisions I made

- **`run_log` needed new columns.** Not in the spec's wording, but its
  acceptance criteria require logging a failure and replaying an input, and
  spec 01's `run_log` could do neither. Migration 0005 rather than working
  around it. Flagging because it changes a spec 01 table.
- **`input_ref` / `output_ref` hold JSON inline**, not a pointer to storage
  despite the `_ref` name. The rerun comparison needs the original input to
  replay and both outputs to display. Payloads are small today. This may want
  revisiting when `event_extraction` starts storing whole scraped pages.
- **I added a "Sample run" button, which the spec does not list.** Spec 02
  builds the gateway but nothing that calls it, so there was no way to create a
  `run_log` row, and acceptance criteria 1 and 3 could not have been checked
  until spec 03. If you would rather it not ship, it is one button and one
  action to delete. **This is the one place I went beyond the written scope.**
- **`tests/migration-sql.ts` was changed.** It read only `0002_tables.sql`, so
  it was blind to columns added by any later migration. It now replays every
  migration in filename order. This strengthens the check rather than weakening
  it, and no assertion was relaxed. Calling it out because CLAUDE.md says never
  edit a test to make it pass; this was the test helper's coverage being wrong,
  and the two new enums were then registered in `tests/schemas.test.ts` because
  the stronger parser correctly demanded them.
- **`eslint.config.mjs` gained `argsIgnorePattern: "^_"`.** `useActionState`
  hands every server action `(prevState, formData)` whether it reads them or
  not. The codebase already used the `_` prefix convention; the linter now
  honours it.
- **Model dropdowns are built from live provider lists**, not a hardcoded
  catalogue, with a short fallback when the fetch fails. A hardcoded list goes
  stale silently, which is exactly what bit Gemini below.

---

## Things you should know

**Gemini's Google Search grounding is quota-blocked on this key.** A plain
`generateContent` returns 200 in the same second that the same call with
`tools: [{google_search: {}}]` returns 429 RESOURCE_EXHAUSTED. Reproducible, not
a transient blip. **This matters for spec 05**, which planned to try Gemini
grounding before adding Tavily or a separate search API (STATUS.md backlog).
As things stand grounding is not usable on the free tier, so spec 05 will
probably need billing enabled on the Google Cloud project or a separate search
API after all. Worth resolving before spec 05 is drafted.

**OpenRouter free models are unreliable by design.** They run on a shared
upstream pool and any of them can return 429 at any moment while the key is
perfectly valid. Six of the seven components default to one. Not a problem for
the assessment, which is interactive and can be retried, but the scheduled jobs
in specs 06 and 11 will need a fallback model or a paid model.

**Gemini's model list lies.** `ListModels` advertises `gemini-2.5-flash`, and
calling it returns 404 "no longer available to new users, use
models/gemini-3.6-flash". So a model appearing in a dropdown is not proof it
works; that is what the Test button is for.

**The Settings page is heavy: ~360KB of HTML.** OpenRouter lists 300+ models and
each of the seven component dropdowns renders all the eligible ones. It renders
in well under a second locally, but this is a mobile PWA and that is worth
trimming if it becomes noticeable.

**Anthropic and Groq are implemented but never exercised.** No keys for either.
The adapters are written from their documented APIs and are unproven.

**No rate limiting on the gateway.** Spec 12b item 3 covers it.

**Note on `docs/specs/12-professionalize.md`:** the line I appended to 12b item 4
says OpenRouter and Gemini are "pending real exercise in spec 02". That is now
done, as of this session. You may want to update that line. Old keys are still
not deleted.

---

## What the next spec needs

Spec 03 (assessment interview) can now assume:

- `runComponent("interview", input)` and `runComponent("persona_synthesis",
  input)` work, validate their output, and log themselves. Import from
  `lib/llm/gateway-server`, never a provider directly.
- Both components already have input and output schemas in
  `lib/llm/components/`. **Their system prompts are stubs** and are spec 03's
  job to write. Do not ship the stubs.
- `profiles.onboarding_state` is `models_configured` once Settings is done.
  Spec 03 should advance it to `assessment_started` then `assessment_complete`
  using `advanceOnboarding` in `lib/onboarding.ts`.
- Per PRD §1.3, every answer is written to `assessment_answers` as it is given,
  not batched at the end.
- Interview output currently returns one question at a time with a
  `more_to_ask` flag. Change the schema if that shape does not suit; nothing
  depends on it yet.

Before spec 05, settle the Gemini grounding question above.
