import type { SearchProviderStatus } from "@/lib/search/credentials";

/**
 * Read-only, server-rendered. Spec 05 item 1.
 *
 * NOT a client component on purpose, and there is deliberately no input to
 * paste a key into: search keys come from the environment only, so the only
 * honest thing this can show is whether each variable is set. It renders a
 * boolean and never a key, a key prefix, or a key length.
 */
export function SearchProviders({ status }: { status: SearchProviderStatus[] }) {
  const configured = status.filter((entry) => entry.configured).length;

  return (
    <div className="flex flex-col gap-3">
      {configured === 0 ? (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          No search provider is configured, so discovery cannot run. Set at least
          one of the variables below in <code>.env.local</code> and in the Vercel
          project settings, then restart the server. The first one alone is
          enough to start.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2">
        {status.map((entry, index) => (
          <li
            key={entry.provider}
            className="flex flex-col gap-1 rounded border border-black/10 p-3 dark:border-white/15"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">
                {index + 1}. {entry.label}
              </span>
              <span
                className={
                  entry.configured
                    ? "text-xs text-green-700 dark:text-green-400"
                    : "text-xs opacity-60"
                }
              >
                {entry.configured ? "Configured" : "Not configured"}
              </span>
            </div>

            <p className="text-xs opacity-70">{entry.freeTier}</p>

            <p className="text-xs opacity-70">
              <code>{entry.envVar}</code>
              {entry.configured ? null : (
                <>
                  {" — "}
                  <a
                    className="underline"
                    href={entry.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    get a key
                  </a>
                </>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
