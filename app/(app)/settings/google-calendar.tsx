"use client";

import { useState, useTransition } from "react";

import { checkGoogleConnection, disconnectGoogleCalendar, type ActionResult } from "./actions";

/**
 * Google Calendar connect/disconnect (spec 08 item 7). Never shows the
 * tokens themselves (CONVENTIONS.md#settings-is-the-operator-surface) --
 * only whether an account is connected, and which one.
 */
export function GoogleCalendar({
  connected,
  email,
  authorizeHref,
  banner,
}: {
  connected: boolean;
  email: string | null;
  authorizeHref: string;
  banner: { tone: "connected" | "error"; message: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function disconnect() {
    setResult(null);
    startTransition(async () => setResult(await disconnectGoogleCalendar()));
  }

  function check() {
    setResult(null);
    startTransition(async () => setResult(await checkGoogleConnection()));
  }

  return (
    <div className="flex flex-col gap-3">
      {banner ? (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          className={
            banner.tone === "error"
              ? "rounded border border-red-500/40 bg-red-500/10 p-3 text-sm"
              : "rounded border border-black/10 p-3 text-sm dark:border-white/15"
          }
        >
          {banner.message}
        </p>
      ) : null}

      {connected ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            Connected as <strong>{email}</strong>
          </span>
          <button
            type="button"
            onClick={check}
            disabled={pending}
            className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
          >
            {pending ? "Checking…" : "Check connection"}
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={pending}
            className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
          >
            {pending ? "…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <a
          href={authorizeHref}
          className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          Connect Google Calendar
        </a>
      )}

      {result && !result.ok ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
      {result?.ok ? <p className="text-xs opacity-80">{result.message}</p> : null}
    </div>
  );
}
