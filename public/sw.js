// FinTrack service worker — offline app shell + reference-data cache.
//
// Strategy:
//   * Navigations (HTML)     -> network-first, falling back to the cached
//     copy of that exact route, then to the cached "/" app shell, so the
//     installed PWA opens while offline.
//   * RSC flight requests (the payloads client-side <Link> navigation fetches
//     under the hood — identified by a `_rsc` query param or an
//     `Accept: text/x-component` header) -> same network-first / cached-copy
//     strategy, keyed on the URL with `_rsc` stripped (that param is a
//     per-navigation cache-buster, not part of the resource's identity) so a
//     route visited once is reachable offline via client-side nav too.
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
// build step — see OFFLINE_DESIGN.md §5.3) — bump SW_VERSION by hand
// whenever the cached asset set or logic changes so `activate` drops the
// previous deploy's cache (§5.1: stale precached shells/chunks after a
// deploy are the main risk this guards against).

const SW_VERSION = "2";
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

/** Cache key for an RSC flight request with the `_rsc` cache-buster stripped. */
function rscCacheKey(request, url) {
  const stripped = new URL(url);
  stripped.searchParams.delete("_rsc");
  return new Request(stripped.toString(), { headers: request.headers });
}

// Next sends `Vary` on HTML/RSC responses (varying on its own router headers)
// so the Cache API's default match — which respects `Vary` — silently misses
// on a fallback lookup whose request headers differ from whatever request
// originally populated the cache (e.g. a plain navigation falling back to a
// shell that was cached from an RSC prefetch, or vice versa). Every match
// here is an intentional same-URL fallback, so ignore Vary throughout.
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

  // App-shell navigations and RSC flight payloads: network-first with a
  // same-resource cache fallback, then the "/" app shell so the installed
  // PWA always opens offline.
  if (request.mode === "navigate" || isRscRequest(request, url)) {
    const cacheKey = isRscRequest(request, url) ? rscCacheKey(request, url) : request;
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(cacheKey, MATCH_OPTS)
            .then((cached) => cached || caches.match("/", MATCH_OPTS)),
        ),
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
