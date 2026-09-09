/**
 * Every Google OAuth/Calendar failure is one of these. Mirrors
 * GatewayFailureKind (lib/llm/errors.ts) down to the reused kind names,
 * since the two DB columns this feeds (selections.gcal_sync_status/
 * gcal_sync_error_kind) reuse run_status/run_error_kind verbatim
 * (docs/specs/08-google-calendar-sync.md decisions) -- a subset of the
 * gateway's kinds, since there is no schema/tools_unsupported/unparseable
 * equivalent for a Calendar API call.
 */
export type GoogleSyncErrorKind =
  /** No google_accounts row for this user. */
  | "not_configured"
  /** Google rejected the credentials, including a refresh that itself failed. */
  | "auth"
  /** Google rate limit or quota (429). */
  | "rate_limited"
  /** Google returned a non-2xx that is not auth or rate limiting. */
  | "provider_error"
  /** Request exceeded the timeout. */
  | "timeout";

export class GoogleSyncError extends Error {
  readonly kind: GoogleSyncErrorKind;
  /** Google's HTTP status, when the failure came from an HTTP response. */
  readonly status?: number;

  constructor(args: {
    kind: GoogleSyncErrorKind;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "GoogleSyncError";
    this.kind = args.kind;
    this.status = args.status;
  }
}

/** Maps a Google HTTP status onto the failure kind logged and displayed. */
export function kindForStatus(status: number): GoogleSyncErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * A non-2xx from Google. Shared by oauth-server.ts and calendar-server.ts so
 * both classify a failed request the same way gateway.ts's own `classify`
 * does for a model provider.
 */
export async function throwForResponse(response: Response, what: string): Promise<never> {
  const body = await response.text().catch(() => "<no response body>");
  throw new GoogleSyncError({
    kind: kindForStatus(response.status),
    message: `${what} returned HTTP ${response.status}: ${truncate(body, 400)}`,
    status: response.status,
  });
}

/** Classifies a thrown fetch failure (network error or AbortSignal.timeout)
 * into the same GoogleSyncError shape a non-2xx response gets. */
export function classifyFetchFailure(cause: unknown, what: string): GoogleSyncError {
  if (cause instanceof GoogleSyncError) return cause;
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return new GoogleSyncError({
      kind: "timeout",
      message: `${what} did not reply in time.`,
      cause,
    });
  }
  return new GoogleSyncError({
    kind: "provider_error",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}
