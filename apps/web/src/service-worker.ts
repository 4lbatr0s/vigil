/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { files, version } from "$service-worker";
import { isNetworkOnly } from "$lib/sw-rules";

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `vigil-${version}`;
// The app shell and the static files (icons, manifest). Built chunks are cached when first used, not
// all at once: the build has a hundred editor language chunks nobody needs on the first visit.
const SHELL = [...files, "/"];

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Old versions of the app are deleted so a new build never serves stale files.
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never touch the API (or anything that is not a plain GET of our own files): the network decides.
  if (isNetworkOnly(url, event.request.method, sw.location.origin)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit; // cache first for the shell and build assets
      try {
        const fresh = await fetch(event.request);
        // Hashed build files never change, so keep each one after its first use.
        if (fresh.ok && url.pathname.startsWith("/_app/immutable/")) await cache.put(event.request, fresh.clone());
        return fresh;
      } catch (err) {
        // Offline and not cached: client-side routes still open through the shell.
        if (event.request.mode === "navigate") {
          const shell = await cache.match("/");
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
