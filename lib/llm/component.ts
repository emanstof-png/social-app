import type { z } from "zod";

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
  "no markdown code fences. The object must match the schema described above " +
  "exactly.";

/** Builds the full system prompt for a component. */
export function systemPromptFor(definition: ComponentDefinition): string {
  return `${definition.systemPrompt}\n\n${JSON_ONLY_INSTRUCTION}`;
}
