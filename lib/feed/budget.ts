/**
 * What the Feed and Calendar are allowed to expand and show (spec 07 item 2).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule), the same shape as
 * lib/discovery/budget.ts: lib/feed/ is server-only reading, but nothing stops
 * a future client component from wanting to show the same window/cap numbers,
 * so this stays importable from either side.
 */

/**
 * Far enough out to plan a few weeks ahead without a one-year-out card
 * cluttering the list. Not user-configurable in this spec.
 */
export const FEED_WINDOW_DAYS = 90;

/**
 * A courtesy cap independent of the window -- a FREQ=DAILY rule with neither
 * COUNT nor UNTIL is unbounded by RFC 5545 itself, and the 90-day window
 * already caps it at 90, but a shorter INTERVAL or a future larger window
 * should never turn one scraped row into an unreasonably long card list.
 * Whichever limit (window, COUNT, UNTIL, or this) is reached first wins.
 */
export const MAX_OCCURRENCES_PER_EVENT = 26;

/**
 * Spec 09 item 1. How far back the Evaluations page and the cron route look
 * for a past, unevaluated occurrence before giving up on ever prompting for
 * it -- a courtesy bound for the *pending* list only; an occurrence someone
 * did answer stays in their own history regardless of age (spec's own
 * drafting decision 9).
 */
export const EVALUATION_LOOKBACK_DAYS = 14;
