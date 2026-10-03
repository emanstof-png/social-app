# DECISION-RULES.md — closed escalation list and lanes

Read by `.claude/agents/architect.md` and by the manager. `CLAUDE.md`'s
High-tier bullet points here instead of restating an open-ended rule
(spec 20 item 3, per `docs/FACTORY.md`'s Governance section — the source of
everything below, carried here verbatim).

## Closed escalation list

Only these reach Eric: a change to `docs/PRD.md`, spending any money at all
(the cap is zero), deleting or repointing real rows, secrets or OAuth
consent, a new dependency beyond the stack, or a manager and architect
disagreement. Anything else is decided by the architect and logged.

## Lanes

Autonomy is granted by lane, not by trust in a session. A PR's lane is set
by what it touches, and the lane decides who merges it.

| Lane | What is in it | Gate to merge |
| --- | --- | --- |
| Low | Docs, tests, loop tooling, pure modules, prompts, UI wired to an existing action | Scripts green and reviewer verdict pass; auto-merge |
| Medium | Server actions, merge logic, new migration files, schema additions | Low gate plus architect ruling on any reviewer flag; auto-merge |
| High | Data migrations over real rows, archiving or repointing rows, secrets, OAuth consent, new dependency, PRD change, spend | Everything above plus a `needs-eric` issue answered; manual merge |

## Rulings

Every architect ruling on something the closed list above doesn't name is
logged here: the question, the answer, and the commit it affected. A ruling
that repeats three times becomes a standing rule in this section rather than
being re-decided each time.

None yet — this file is seeded with the closed list and lane table only, as
spec 20 item 3 scopes it. The first ruling (spec 20 item 3's own tier
assignment for items 3 and 4 as Medium, not High — see
`docs/specs/20-factory-phase-1.md`'s Decisions section) was made while
drafting, before the architect role existed, so it is recorded there rather
than here; the next one goes here.
