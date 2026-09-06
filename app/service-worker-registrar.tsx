"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker shell. Renders nothing.
 * Registration failures are logged, not swallowed silently.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("[gazelle] service worker registration failed", error);
    });
  }, []);

  return null;
}
