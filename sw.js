const CACHE_VERSION = "cruciverba-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./cruciverba.html",
  "./manifest.webmanifest",
  "./version.json",
  "./icons/icon.svg",
  "./cruciverba_db.json",
  "./gen_dense.js",
  "./README.md"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  event.respondWith(
    caches.match(request).then((cached) => {
      if (request.mode === "navigate") {
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        }).catch(() => cached || caches.match("./index.html"));
      }

      if (
        url.origin === self.location.origin &&
        (url.pathname.endsWith("/version.json") || url.pathname.endsWith("/cruciverba_db.json"))
      ) {
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached || Response.error());
      }

      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "error") return response;

        if (url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }

        return response;
      }).catch(() => {
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
