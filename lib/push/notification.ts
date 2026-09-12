/**
 * The evaluation-prompt push payload (spec 09 item 3). Pure: no Supabase, no
 * fetch, no process.env (docs/CONVENTIONS.md#pure-core-server-edge).
 */

export type EvaluationPromptSource = {
  eventTitle: string;
  communityName: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

export function buildEvaluationPrompt(card: EvaluationPromptSource): PushPayload {
  return {
    title: `How was ${card.eventTitle}?`,
    body: `Let us know how it went at ${card.communityName}.`,
    url: "/evaluations",
  };
}
