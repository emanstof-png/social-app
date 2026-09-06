import type { LlmComponent } from "../schemas/enums";

/**
 * Every gateway failure is one of these. CLAUDE.md says fail loudly: the
 * gateway never returns a partial or guessed result, it throws, the caller
 * stops that item, and the failure is written to run_log and surfaced in the UI.
 */
export type GatewayFailureKind =
  /** No model_settings row, or the provider has no key configured. */
  | "not_configured"
  /** Provider rejected the credentials (401/403). */
  | "auth"
  /** Provider rate limit or quota (429). */
  | "rate_limited"
  /** Provider returned a non-2xx that is not auth or rate limiting. */
  | "provider_error"
  /** Provider replied, but the body was not usable JSON. */
  | "unparseable"
  /** Provider replied with JSON that failed the component's output schema. */
  | "schema"
  /** A tool-requiring component was pointed at a model without tool support. */
  | "tools_unsupported"
  /** Request exceeded the timeout. */
  | "timeout";

export class GatewayError extends Error {
  readonly kind: GatewayFailureKind;
  readonly component: LlmComponent;
  readonly model: string;
  /** Provider HTTP status, when the failure came from an HTTP response. */
  readonly status?: number;
  /** Whether a retry was already spent before this error was raised. */
  readonly retried: boolean;

  constructor(args: {
    kind: GatewayFailureKind;
    component: LlmComponent;
    model: string;
    message: string;
    status?: number;
    retried?: boolean;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "GatewayError";
    this.kind = args.kind;
    this.component = args.component;
    this.model = args.model;
    this.status = args.status;
    this.retried = args.retried ?? false;
  }
}

/** Maps a provider HTTP status onto the failure kind we log and display. */
export function kindForStatus(status: number): GatewayFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  return "provider_error";
}
