// ══════════════════════════════════════════════════════════
//  MyToDo — Service Worker (sw.js)
//  Caches app shell + Firebase SDK + fonts on first visit.
//  On subsequent visits (even offline) everything loads from cache.
// ══════════════════════════════════════════════════════════

const CACHE_NAME = "taskflow-v1";

// Files to pre-cache on install
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  // Firebase SDK (CDN, pinned version)
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js",
  // Google Fonts CSS
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap"
];

// ── INSTALL: pre-cache the app shell ─────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use allSettled so one failure doesn't break the whole install
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(e => console.warn("[SW] Could not cache:", url, e))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: delete old caches ──────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first strategy ──────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Let Firebase data/auth API calls go through network only
  // (the Firebase SDK manages its own offline queue)
  const isFirebaseApi =
    url.hostname.includes("firebaseio.com") ||
    (url.hostname.includes("googleapis.com") && url.pathname.includes("/identitytoolkit")) ||
    url.hostname.includes("securetoken.googleapis.com") ||
    url.hostname.includes("accounts.google.com");

  if (isFirebaseApi) return; // don't intercept

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Serve from cache if available
      if (cached) return cached;

      // Otherwise fetch from network and cache the response
      return fetch(event.request)
        .then((response) => {
          if (
            !response ||
            response.status !== 200 ||
            event.request.method !== "GET"
          ) {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Network failed and nothing cached:
          // For HTML navigation → fall back to cached index.html
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("", { status: 408, statusText: "Offline" });
        });
    })
  );
});
