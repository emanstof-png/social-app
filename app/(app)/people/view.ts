import type { InteractionKind, InteractionRow } from "@/lib/schemas";
import type { ContactCard } from "./data";

/**
 * View models shared by the People page's server actions and its client
 * components (spec 10 item 1).
 *
 * DIRECTIVE-FREE ON PURPOSE (CLAUDE.md hard rule): actions.ts is "use server"
 * and people-view.tsx is "use client", and both import from here.
 */

export type ActionResult =
  | { ok: true; note?: string }
  /** Shown to the user as-is (CLAUDE.md: fail loudly). */
  | { ok: false; error: string };

/** Every kind logInteraction (item 3) accepts -- narrower than the column's
 * full interaction_kind enum. 'met' is written exactly once, by
 * createContact, so it is deliberately excluded here. */
export const LOGGABLE_INTERACTION_KINDS = ["text", "invite", "hangout"] as const;
export type LoggableInteractionKind = (typeof LOGGABLE_INTERACTION_KINDS)[number];

export const INTERACTION_KIND_LABELS: Record<InteractionKind, string> = {
  met: "Met",
  text: "Texted",
  invite: "Invited",
  hangout: "Hung out",
};

/** Archived contacts are shown apart, the same shape as
 * communities/view.ts's partitionByArchived -- kept local per
 * docs/CONVENTIONS.md's own note that every route's view.ts stays
 * self-contained rather than importing another route's version. */
export function partitionByStatus<T extends { status: string }>(
  contacts: T[],
): { active: T[]; archived: T[] } {
  return {
    active: contacts.filter((one) => one.status !== "archived"),
    archived: contacts.filter((one) => one.status === "archived"),
  };
}

export type Tally = { total: number; byKind: Record<InteractionKind, number> };

/**
 * Counted live on every read, never stored as a counter -- the interactions
 * table's own migration comment states this as the design (PRD §4.5), and
 * this is where it's honored: a fresh render after logInteraction's
 * revalidation always reflects every row, not a value cached anywhere.
 */
export function tally(interactions: InteractionRow[]): Tally {
  const byKind: Record<InteractionKind, number> = { met: 0, text: 0, invite: 0, hangout: 0 };
  for (const interaction of interactions) {
    byKind[interaction.kind] += 1;
  }
  return { total: interactions.length, byKind };
}

/** The most recent interaction's occurred_at, or null if there are none yet. */
export function mostRecentInteraction(interactions: InteractionRow[]): string | null {
  if (interactions.length === 0) return null;
  return interactions.reduce((latest, one) => (one.occurred_at > latest ? one.occurred_at : latest), interactions[0].occurred_at);
}

/**
 * The People list's client-side text filter (item 7) -- loadPeopleData
 * already reads every contact once, so narrowing happens in the browser with
 * no new server round trip. Matches name, phone, email, notes, or met-at
 * community/event name, case-insensitive.
 */
export function matchesQuery(contact: ContactCard, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystacks = [
    contact.name,
    contact.phone,
    contact.email,
    contact.notes,
    contact.metAtCommunityName,
    contact.metAtEventTitle,
  ];

  return haystacks.some((value) => value?.toLowerCase().includes(needle));
}

/** The compose panel's fixed, non-LLM template (Decision: no LLM component
 * here -- invite_suggestion's real prompt is spec 11's). */
export function composeTemplate(contactName: string): string {
  return `Hey ${contactName}, it was great meeting you! Would love to hang out again sometime.`;
}
