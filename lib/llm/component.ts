import { z } from "zod";

import type { LlmComponent } from "../schemas/enums";
import type { ChatMessage, ToolDefinition } from "./types";

/**
 * The gateway contract every component satisfies (ARCHITECTURE.md): input
 * schema, output schema, system prompt, tools if any.
 *
 * Spec 02 ships schemas plus stub system prompts. The real prompts arrive with
 * the spec that uses each component (03, 04, 05, 06, 11).
 */
export type ComponentDefinition<
  InputSchema extends z.ZodType = z.ZodType,
  OutputSchema extends z.ZodType = z.ZodType,
> = {
  id: LlmComponent;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  /** Stub in spec 02. Replaced by the spec that puts the component to work. */
  systemPrompt: string;
  /** Turns validated input into the chat turns sent to the provider. */
  buildMessages: (input: z.infer<InputSchema>) => ChatMessage[];
  /**
   * A canned input for the "Sample run" button in Settings.
   *
   * Spec 02 builds the gateway but nothing that calls it yet, so without this
   * there is no way to produce a run_log row, and two of the spec's own
   * acceptance criteria (a dropdown change showing up in run_log, and the
   * side-by-side rerun) could not be demonstrated until spec 03.
   */
  sampleInput: z.infer<InputSchema>;
  tools?: ToolDefinition[];
  /**
   * Reasoning models spend this budget on hidden thinking before any visible
   * text, so keep it generous. See the note in types.ts.
   */
  maxOutputTokens: number;
  temperature?: number;
};

/**
 * Appended to every system prompt. The gateway parses strict JSON out of the
 * reply, so the instruction has to be unambiguous regardless of which model
 * the user picked in Settings.
 */
export const JSON_ONLY_INSTRUCTION =
  "Reply with a single JSON object and nothing else. No prose, no explanation, " +
  "no markdown code fences. Include every required property, even when a value " +
  "is empty: use [] for an empty list and null for an unknown value. Do not add " +
  "properties that are not in the schema.";

/**
 * The component's output schema, as JSON Schema, for the model to follow.
 *
 * Derived from the Zod schema rather than written by hand so the two cannot
 * drift: the same object the model is shown is the one its reply is validated
 * against. Without this the models were told to match "the schema" while
 * nothing in the prompt described it, and free models duly omitted required
 * keys -- minimax/minimax-m3:free dropped `goals` from persona_synthesis on
 * both the first attempt and the retry.
 */
export function outputSchemaJson(definition: ComponentDefinition): string {
  const schema = z.toJSONSchema(definition.outputSchema, {
    // The reply is validated by Zod anyway; unrepresentable corners should not
    // stop a prompt being built.
    unrepresentable: "any",
    io: "output",
  });
  return JSON.stringify(schema, null, 2);
}

/** Builds the full system prompt for a component. */
export function systemPromptFor(definition: ComponentDefinition): string {
  return [
    definition.systemPrompt,
    "",
    "Your reply must validate against this JSON Schema:",
    outputSchemaJson(definition),
    "",
    JSON_ONLY_INSTRUCTION,
  ].join("\n");
}
