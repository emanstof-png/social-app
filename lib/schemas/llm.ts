import { z } from "zod";

import { rowBase, timestampedRowBase, uuid } from "./common";
import { llmComponent, llmProvider } from "./enums";

/** Which model each component uses. One row per component, user-editable. */
export const modelSettingRow = timestampedRowBase.extend({
  component: llmComponent,
  provider: llmProvider,
  model: z.string().min(1),
  supports_tools: z.boolean(),
});

export const modelSettingInsert = modelSettingRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({ supports_tools: true });

export const modelSettingUpdate = modelSettingInsert
  .omit({ user_id: true, component: true })
  .partial();

/**
 * `key` holds ciphertext only, encrypted in the application with ENCRYPTION_KEY.
 * `base_url` is for the local provider (Ollama / LM Studio).
 */
export const providerKeyRow = timestampedRowBase.extend({
  provider: llmProvider,
  key: z.string().nullable(),
  base_url: z.string().nullable(),
});

export const providerKeyInsert = providerKeyRow
  .omit({ id: true, created_at: true, updated_at: true })
  .partial({ key: true, base_url: true });

export const providerKeyUpdate = providerKeyInsert
  .omit({ user_id: true, provider: true })
  .partial();

/** Mirrors public.run_status and public.run_error_kind (migration 0005). */
export const runStatus = z.enum(["ok", "error"]);
export const runErrorKind = z.enum([
  "not_configured",
  "auth",
  "rate_limited",
  "provider_error",
  "unparseable",
  "schema",
  "tools_unsupported",
  "timeout",
]);

/** One row per gateway call, successful or not. Append-only. */
export const runLogRow = rowBase.extend({
  component: llmComponent,
  provider: llmProvider.nullable(),
  model: z.string().min(1),
  input_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  latency_ms: z.number().int().nonnegative().nullable(),
  status: runStatus,
  error_kind: runErrorKind.nullable(),
  error_message: z.string().nullable(),
  /** 0 when the run failed before any provider call (no key, no tool support). */
  attempts: z.number().int().min(0),
  rerun_of: uuid.nullable(),
});

export const runLogInsert = runLogRow
  .omit({ id: true, created_at: true })
  .partial({
    provider: true,
    input_ref: true,
    output_ref: true,
    tokens_in: true,
    tokens_out: true,
    cost_usd: true,
    latency_ms: true,
    status: true,
    error_kind: true,
    error_message: true,
    attempts: true,
    rerun_of: true,
  });

export type ModelSettingRow = z.infer<typeof modelSettingRow>;
export type ModelSettingInsert = z.infer<typeof modelSettingInsert>;
export type ModelSettingUpdate = z.infer<typeof modelSettingUpdate>;
export type ProviderKeyRow = z.infer<typeof providerKeyRow>;
export type ProviderKeyInsert = z.infer<typeof providerKeyInsert>;
export type ProviderKeyUpdate = z.infer<typeof providerKeyUpdate>;
export type RunLogRow = z.infer<typeof runLogRow>;
export type RunLogInsert = z.infer<typeof runLogInsert>;
export type RunStatus = z.infer<typeof runStatus>;
export type RunErrorKind = z.infer<typeof runErrorKind>;
