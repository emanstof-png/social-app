# Holding note — the practice layer, and a sharper problem statement
Not settled, creates no obligation, and a spec that ignores it is not wrong. Captured from a planning conversation on 2026-09-07 (not this repo's session), before specs 07-11 are drafted. Read this before drafting spec 09 or spec 11 — it may change what either one is for.

## A sharper problem statement, worth replacing the PRD's framing
This is about the logistics of building a social life, not motivation or loneliness. Five real problems:

1. Never knowing what to do.
2. Not knowing where events are.
3. Hours per week spent searching.
4. Losing track of people among too many contacts.
5. Not showing up, with social skills that have atrophied.

Specs 03-06 cover problems 1-3 and are built. Spec 10 covers problem 4. Problem 5 is barely scoped anywhere in the current specs and is what nothing on the market does well — see the practice layer below.

## Audience
Not "lonely people" — people who have been chronically online since 2020 and got out of practice. Motivated and goal-oriented; logistics are what they find brutal, not a lack of desire. The framing that fits is reloading an atrophied skill, not fixing someone broken.

Meetup is not the competition. The real communities worth finding are small and niche, often with a website that hasn't changed since 2009 — which is exactly why spec 05 needed a multi-round research loop instead of one search call.

## Quest layer for gazelle
Small, concrete assignments rather than open-ended encouragement: go to the thing, do one specific task, report back. Spec 09's evaluation loop is already the back half of this — it just needs the front half (assigning the task) to exist.

## dojo — a separate practice surface
Same loop, different arena: boundary setting, negotiation, speaking up in meetings, randomized conversational reps.

**Architecture, if built.** Not a realtime voice API. Speech-to-text, then a text model, then text-to-speech — more latency, but that's fine for practice, and roughly an order of magnitude cheaper. Tone analysis is a separate pass over the raw audio (pitch contour, words per minute, volume, pause length, filler frequency) — much of it signal processing rather than model calls — handed to a grader after the session rather than run continuously. Cost levers, in order: the STT+LLM+TTS split itself, a cheap model for the drill and an expensive one only for grading, short sessions by design, and batched (not live) grading.

**Visual feedback.** Show the tone measurements as graphs to practice against — game-like. Use ranges, not target curves: there is no single correct pitch pattern, and it varies by culture and by speaker.

**Grounding.** Vocal prosody and persuasion has a real research base; business-school negotiation and organizational-behavior work is the most directly applicable literature. Needs a proper literature pass before setting any of the ranges above.

## Pricing sketch
Social logistics around $25/month; dojo around $80-90, anchored against executive coaching. Probably one product with tiers, since the loop is shared rather than two separate products.

Unlimited voice practice does not work at any consumer price: at realtime pricing, an hour a day costs more than the subscription, and three hours a week is roughly $90-130/month in voice cost before the architecture changes above are applied. Needs an allowance plus overage, or a high tier priced for it. The power users are the target audience here, so this is the normal case to design for, not an edge case.

## Telemetry
The loop produces practice tied to a real-world outcome, which most conversational-practice tools cannot collect. `run_log` and the evaluation tables are close to the right shape already. Consent and handling for voice recordings of personal conflict would need settling before any of this is built.

## Not decided
- Whether social logistics and dojo end up as one product or two.
- Whether the quest layer belongs inside spec 09 or spec 11, or gets its own spec.
- Whether dojo is a later add-on project or a pivot.

Specs 07-11 come first regardless of how any of this resolves.
