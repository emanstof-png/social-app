"use client";

import { useEffect, useState, useTransition } from "react";

import { subscribeToPush, unsubscribeFromPush, type ActionResult } from "./actions";

/**
 * Web Push subscribe/unsubscribe (spec 09 item 3).
 *
 * Whether *this* device is subscribed lives in the browser's own
 * PushManager, not something the server can hand down as a prop, so it's
 * read on mount rather than passed in. Never echoes key material
 * (CONVENTIONS.md#settings-is-the-operator-surface) -- there is nothing
 * secret to echo, only whether a subscription exists.
 */
export function Push({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<
    "loading" | "unsupported" | "subscribed" | "unsubscribed"
  >("loading");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setStatus(existing ? "subscribed" : "unsubscribed");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    setResult(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setResult({ ok: false, error: "Notification permission was not granted." });
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
        const outcome = await subscribeToPush(subscription.toJSON());
        setResult(outcome);
        if (outcome.ok) setStatus("subscribed");
      } catch (cause) {
        setResult({
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    });
  }

  function disable() {
    setResult(null);
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const endpoint = subscription?.endpoint;
        await subscription?.unsubscribe();
        const outcome = endpoint
          ? await unsubscribeFromPush(endpoint)
          : ({ ok: true, message: "Disabled." } as const);
        setResult(outcome);
        setStatus("unsubscribed");
      } catch (cause) {
        setResult({
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    });
  }

  if (status === "loading") return null;
  if (status === "unsupported") {
    return (
      <p className="text-sm opacity-70">
        This browser does not support push notifications.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {status === "subscribed" ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Enabled on this device.</span>
          <button
            type="button"
            onClick={disable}
            disabled={pending}
            className="rounded border border-current px-2 py-1 text-xs disabled:opacity-50"
          >
            {pending ? "…" : "Disable"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={pending}
          className="self-start rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
        >
          {pending ? "Enabling…" : "Enable push notifications"}
        </button>
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

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
