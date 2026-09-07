# How a spec is written

The spec schema. `docs/CONVENTIONS.md` is the code schema; this file is the
shape of the document that asks for the code.

Read this before drafting anything under `docs/specs/`.
`docs/specs/05-community-discovery.md` is the depth exemplar. Specs 01 and 02
are pre-format sketches: they are not retrofitted and their shape is not copied.

## Document kinds

Three, distinguished by filename.

**Spec — `NN-<kebab-name>.md`.** Complete and buildable in one Claude Code
session, with every required section below. It is what a build session is
pointed at, and it is the only kind that gets a git tag.

**Addendum — `NN-<topic>-addendum.md`.** Settles a decision for a spec that has
not been drafted yet, written at the moment the decision is made so it is not
lost between sessions. Binding. It is folded into the spec at drafting time and
named by filename in the spec's opening paragraph.
`docs/specs/05-discovery-addendum.md` is the model.

**Note — `NN-<topic>-note.md`.** A holding note for an idea. Not settled,
creates no obligation, and a spec that ignores it is not wrong.
`docs/specs/10-crm-addition-note.md` says so in its own first line.

## Required sections, in order

**1. Title and PRD section reference.** `# Spec NN — <name> (PRD §x.y–x.z)`. If
nothing in `docs/PRD.md` covers it, say which spec's output it serves instead.

**2. Opening paragraph.** What this spec starts from, meaning which prior spec's
output it consumes; what it ends with; and every addendum to read first, named
by filename in bold. Not a summary of the scope. If a named addendum is missing
from the repo, `CLAUDE.md` tells the build session to stop and ask.

**3. Prerequisites the human has to do first.** Accounts, keys, env var names,
and where each one goes: `.env.local`, Vercel (Production and Preview), GitHub
repository secrets. Say which of them implementation can start without. Omit the
section only when there are none.

**4. What is already built, do not rebuild.** The named files, functions,
tables, indexes and gates from prior specs this one depends on, with what each
one already guarantees. This is the section that stops a build session rewriting
working code, so name real symbols, not areas.

**5. Scope.** Numbered items, each buildable and checkpointable on its own, each
naming the files it creates or touches and its tests, ordered so no item depends
on a later one. Group into seams if the checkpoint rhythm needs it. An item that
cannot be summarised in 3-5 lines at its checkpoint is two items.

**6. Decisions made while drafting, do not re-litigate.** Every call the drafter
made that a build session might otherwise reopen, each with its reasoning. A
decision with no reasoning will be reopened, so this section is prose, not a
list of verdicts.

**7. Acceptance criteria.** Observable statements a person or a test can check,
phrased as behaviour. Must include the `CLAUDE.md` verification sentence: `next
build` passing is not enough, a production server must serve a real
authenticated request exercising the feature, and `REVIEW.md` must state which
of the two was done.

**8. Out of scope.** Adjacent work explicitly deferred, and to which spec.

Optional, where they apply: a default-models table for any new LLM component,
with the reasoning; budget constants.

## Scope item versus acceptance criterion

Scope says what to build and where. Acceptance says how we know it works, as
behaviour observable from outside. "Add `lib/search/chain.ts` with fall-through"
is scope; "Exa returning 429 falls through to Tavily within the same run and
both attempts appear in `search_log`" is acceptance. If a sentence cannot be
checked, it is not an acceptance criterion.

## Citing conventions

Specs do not restate `docs/CONVENTIONS.md`. A scope item says "per
`CONVENTIONS.md#page-layout`" and spells out only its deviations. A spec that
needs a pattern the conventions do not cover adds it to `docs/CONVENTIONS.md` as
a numbered scope item of that spec, so the schema grows in one file.

## Drafting process

Draft a spec when its phase starts and never earlier, against what shipped
rather than what was planned. Spec 04's original sketch was written before specs
01 through 03 existed and had to be thrown out.

Read first, in this order: the PRD section, `docs/ARCHITECTURE.md`, `STATUS.md`,
the previous spec's `REVIEW.md`, every addendum for this spec,
`docs/CONVENTIONS.md`, and `docs/specs/05-community-discovery.md` for depth.

Pre-approve the known decisions in the spec so a build session can run without
stopping to ask about something already settled. Every new table implies a Zod
schema and a test entry; every new LLM component implies a default model with
reasoning; every new environment variable implies a `docs/ARCHITECTURE.md` line.
Say so in the spec rather than leaving it to be inferred.

A spec is approved at the review gate in the planning chat, committed to
`docs/specs/`, pushed, and left untagged until it is built.

## Worked example: spec 05

`docs/specs/05-community-discovery.md` checked against the eight required
sections. All eight are present, in the required order:

| # | Section | In spec 05 |
| --- | --- | --- |
| 1 | Title and PRD reference | `# Spec 05 — Community discovery (PRD §2.1–2.2)` |
| 2 | Opening paragraph | Starts from spec 04's focus set, ends at `communities` rows; names `05-discovery-addendum.md` in bold |
| 3 | Prerequisites | "Before implementation starts: keys Eric has to obtain", a table of three providers, env vars and where each goes |
| 4 | Already built | Ten entries, from the focus set to the Playwright harness |
| 5 | Scope | Eight items, each naming its files and tests |
| 6 | Decisions while drafting | Nine, each with reasoning |
| 7 | Acceptance criteria | Ten, ending with the `CLAUDE.md` verification rule |
| 8 | Out of scope | Specs 06 through 11, named individually |

Three deviations of form, all accepted as the exemplar's shape rather than
faults:

- Scope items are `### N. <title>` subsections rather than a plain numbered
  list. At spec 05's size that is easier to check off at a checkpoint. Spec 04
  uses the flat list, and either is fine.
- The default-models table sits inside scope item 5 rather than in a section of
  its own, next to the components it configures.
- The prerequisites heading names the human. Harmless, and it made the section
  impossible to skim past.

One thing spec 05 could not have done, recorded so it is not read as a rule: its
opening paragraph names one addendum, and
`docs/specs/05-duplicate-names-addendum.md` is not in it, because that addendum
was written at spec 05's own review gate after the spec was built. An addendum
that exists at drafting time is named; one that does not cannot be.
