import { z } from "zod";

import { rowBase, uuid } from "./common";
import { searchProvider } from "./enums";
import { runErrorKind, runStatus } from "./llm";

/**
 * One row per search API call, successful or not (migration 0009).
 *
 * Append-only in practice. Its point is that a fall-through from Exa to Tavily
 * is a visible record rather than something inferred from a gap.
 */
export const searchLogRow = rowBase.extend({
  provider: searchProvider,
  query: z.string().min(1),
  /** Null for a dry run or a Settings connection check. */
  discovery_run_id: uuid.nullable(),
  /**
   * 0 is a real answer. A provider that returns zero results has succeeded and
   * the chain does not fall through on it -- empty results are the research
   * loop's problem, empty because of quota is the chain's.
   */
  result_count: z.number().int().nonnegative().nullable(),
  status: runStatus,
  error_kind: runErrorKind.nullable(),
  error_message: z.string().nullable(),
  latency_ms: z.number().int().nonnegative().nullable(),
});

export const searchLogInsert = searchLogRow
  .omit({ id: true, created_at: true })
  .partial({
    discovery_run_id: true,
    result_count: true,
    status: true,
    error_kind: true,
    error_message: true,
    latency_ms: true,
  });

export type SearchLogRow = z.infer<typeof searchLogRow>;
export type SearchLogInsert = z.infer<typeof searchLogInsert>;
