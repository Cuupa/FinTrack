// FinTrack service worker — offline app shell + reference-data cache.
//
// Strategy:
//   * Navigations (HTML) -> network-first, falling back to the cached HTML
//     copy of that exact route, then to the cached "/" app shell, so the
//     installed PWA opens while offline. This branch only ever reads/writes
//     HTML-keyed cache entries (see key scheme below) — it can never resolve
//     to an RSC flight body.
//   * RSC flight requests (the payloads client-side <Link> navigation fetches
//     under the hood — identified by a `_rsc` query param or an
//     `Accept: text/x-component` header) -> network-first, cached under a
//     dedicated key so a route visited once is reachable offline via
//     client-side nav too. On a cache miss offline this branch returns a
//     failed response rather than substituting the HTML shell — Next
//     detects the RSC fetch failure and performs a hard navigation instead,
//     which is handled by the navigate branch above.
//   * Key scheme (why two requests to the same route never collide): a plain
//     navigation caches under the route's own URL untouched. An RSC request
//     is cached under that same URL plus a stable `__rsc=1` marker query
//     param (the real `_rsc` cache-buster is stripped first, since it's a
//     per-request timestamp, not part of the resource's identity). Distinct
//     keys mean a navigate fallback can never match an RSC entry, and an
//     online RSC prefetch can never overwrite the precached HTML shell.
//   * Same-origin static assets (/_next/*, fonts, icons) -> stale-while-
//     revalidate: serve the cached copy instantly if present, refresh it in
//     the background.
//   * /api/catalog (reference data: instruments, constituents, FX) -> cache-
//     first with a background refresh, so last-known prices/constituents
//     survive offline; never blocks on the network once cached.
//   * Every other /api/* route (quotes, fx, price, history, lookup, and all
//     mutation/cron endpoints) is left untouched — financial data and writes
//     must always be live, never served from the cache.
//
// public/sw.js is a static file Turbopack does not bundle (no imports, no
// build step, see OFFLINE_DESIGN.md §5.3), so it stays dependency-free
// vanilla JS. SW_VERSION itself is no longer bumped by hand: it's derived at
// build time (scripts/generate-sw-version.mjs, run via npm's "prebuild" hook)
// into the generated, gitignored public/sw-version.js, which this file pulls
// in via importScripts (the one loading mechanism a static, unbundled SW
// has available). That keeps `CACHE` unique per deploy so `activate` always
// drops the previous deploy's cache (OFFLINE_DESIGN.md §5 risk 1: stale
// precached shells/chunks after a deploy are the main risk this guards
// against), without hand-editing this file on every shell-affecting change.
// If sw-version.js hasn't been generated (no build has run yet, e.g. a fresh
// checkout only ever run through `next dev`), fall back to a static version:
// offline behavior still works, only the auto-bump on deploy is skipped.
self.SW_BUILD_VERSION = undefined;
try {
  importScripts("/sw-version.js");
} catch {
  // Missing/unreachable, use the fallback below.
}
const SW_VERSION = typeof self.SW_BUILD_VERSION === "string" ? self.SW_BUILD_VERSION : "dev";
const CACHE = `fintrack-v${SW_VERSION}`;

// Routes that prerender as a static shell (the "○" marks in `next build`
// output — verify against that output whenever routes change). Dynamic-
// segment routes (/assets/[id], /shared/[id]) render on demand and have no
// fixed shell to precache; they're cached opportunistically the first time
// they're visited online, same as any other navigation.
const PRECACHE_ROUTES = [
  "/",
  "/analysis",
  "/login",
  "/rebalancing",
  "/settings",
  "/shared",
  "/simulation",
  "/system",
  "/xray",
];
const APP_SHELL = [...PRECACHE_ROUTES, "/icon.svg", "/manifest.webmanifest"];

// Live financial data must never be served from the cache.
const NEVER_CACHE_API = ["/api/quotes", "/api/fx", "/api/price", "/api/history", "/api/lookup"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isRscRequest(request, url) {
  if (url.searchParams.has("_rsc")) return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/x-component");
}

/**
 * Cache key for an RSC flight request: the `_rsc` cache-buster (a
 * per-request timestamp, not part of the resource's identity) is stripped,
 * and a stable `__rsc=1` marker is added in its place. The marker is what
 * keeps this key from ever colliding with the HTML cache entry for the same
 * route — the navigate branch below caches/matches that route's plain URL,
 * untouched. Without the marker, both request types would cache under the
 * same key and a fallback lookup could return either response type for
 * either kind of request.
 */
function rscCacheKey(request, url) {
  const marked = new URL(url);
  marked.searchParams.delete("_rsc");
  marked.searchParams.set("__rsc", "1");
  return new Request(marked.toString(), { headers: request.headers });
}

// Next sends `Vary` on HTML/RSC responses (varying on its own router headers)
// so the Cache API's default match — which respects `Vary` — silently misses
// on a fallback lookup whose request headers differ from whatever request
// originally populated the cache, even though the URL (cache key) is exactly
// the same. Every match here is an intentional same-key fallback, so ignore
// Vary throughout. This is safe from cross-type bleed: HTML and RSC entries
// now live under distinct keys (see rscCacheKey above), so ignoring Vary can
// only ever match a same-type entry.
const MATCH_OPTS = { ignoreVary: true };

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch provider APIs

  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/catalog") {
      // Cache-first with background refresh: reference data survives offline,
      // and an online tab still refreshes the cache for next time.
      event.respondWith(
        caches.match(request, MATCH_OPTS).then((cached) => {
          const network = fetch(request)
            .then((res) => {
              if (res && res.status === 200) {
                const copy = res.clone();
                caches.open(CACHE).then((cache) => cache.put(request, copy));
              }
              return res;
            })
            .catch(() => cached);
          return cached || network;
        }),
      );
      return;
    }
    if (NEVER_CACHE_API.some((p) => url.pathname.startsWith(p))) return; // live data, never cached
    return; // every other /api/* route (mutations, lookup, cron, …) also passes straight through
  }

  // App-shell navigations (HTML): network-first, falling back to the cached
  // HTML copy of this exact route, then to the cached "/" app shell so the
  // installed PWA always opens offline. Cached and matched only under the
  // route's own URL (an RSC request for the same route never writes here —
  // see rscCacheKey above), so this can never resolve to an RSC flight body.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request, MATCH_OPTS).then((cached) => cached || caches.match("/", MATCH_OPTS)),
        ),
    );
    return;
  }

  // RSC flight payloads (client-side <Link> navigation fetches): network-
  // first, cached under the dedicated `__rsc=1` key so a route visited once
  // is reachable offline via client-side nav too. On a cache miss, do NOT
  // fall back to the HTML shell — an RSC response and an HTML response are
  // not interchangeable, and Next's router already handles a failed RSC
  // fetch by performing a hard navigation (which the navigate branch above
  // serves from cache). Returning a failed response here is what lets that
  // fallback kick in instead of rendering a flight body as a page.
  if (isRscRequest(request, url)) {
    const cacheKey = rscCacheKey(request, url);
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
          return res;
        })
        .catch(() => caches.match(cacheKey, MATCH_OPTS).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Static assets (/_next/*, fonts, images): stale-while-revalidate.
  event.respondWith(
    caches.match(request, MATCH_OPTS).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

// Web push (COMPETITION.md F5). The cron sends a JSON payload
// { title, body, url }; show it as a notification, and focus/open the app at
// `url` when it's clicked. Reminders only (dividend pay-day, savings-plan due)
// — there are no marketing pushes.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "FinTrack";
  const options = {
    body: data.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: data.url || "/" },
    tag: "fintrack-reminder",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if one is open, else open a new one.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
