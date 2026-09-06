/**
 * gazelle service worker — shell only (spec 01).
 *
 * Deliberately minimal: lifecycle + an offline fallback for navigations.
 * No push handlers yet (spec 09) and no caching of app data or API responses,
 * because every page is auth-gated and per-user; serving a stale shell to the
 * wrong session would be worse than being offline.
 */

const CACHE = "gazelle-shell-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Only navigations. Everything else goes straight to the network.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(CACHE);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ??
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
        );
      }
    })(),
  );
});
