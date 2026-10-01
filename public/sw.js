/* 国运 PWA shell. API/save requests deliberately stay network-only. */
const APP_VERSION = "0.4.19";
const CACHE_NAME = `tianxia-shell-${APP_VERSION}-geography-20260913-3`;
const CORE_ASSETS = [
  "/",
  "/play/",
  "/download/",
  "/home.css?v=home-audit-20260919-1",
  "/styles.css?v=marker-lod-20260930",
  "/vendor/d3.v7.min.js?v=v3-20260813",
  "/version.js?v=app-0.4.19",
  "/era-config.js?v=tang-atlas-20260825-1",
  "/data/eurasia-factions-741.js?v=verified-ranges-20260913",
  "/data/strategy-adjacency.js?v=p0-adjacency1-20260821",
  "/data/tang-map-model.js?v=tang-map-model-v2",
  "/regions.js?v=p0-adjacency2-20260824",
  "/cloud-save.js?v=cloud-queue-20260919",
  "/geo-map.js?v=marker-collision-20260930",
  "/perf-harness.js?v=perf-harness-20260824-3",
  "/game.js?v=marker-lod-20260930",
  "/pwa.js?v=app-0.4.19",
  "/manifest.webmanifest",
  "/icon-192.svg",
  "/icon-512.svg",
  "/favicon.svg?v=v3-20260813",
  "/data/natural-earth-land-110m.geojson?v=tang741-v1",
  "/data/natural-earth-rivers.geojson?v=tang741-v1",
  "/data/natural-earth-lakes.geojson?v=tang741-v1",
  "/data/natural-earth-terrain.geojson?v=tang741-v1",
  "/data/strategy-regions.geojson?v=tang741-v2",
  "/data/strategy-provinces.geojson?v=tang741-v2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("tianxia-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION" && event.ports?.[0]) {
    event.ports[0].postMessage({ type: "VERSION", version: APP_VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Release manifests and installers are published independently of the app
  // shell. Never let the offline shell cache a stale placeholder manifest or
  // intercept a binary download.
  if (url.pathname.startsWith("/downloads/") || url.pathname.startsWith("/download/")) return;
  if (request.mode === "navigate") {
    // Never overwrite the homepage with /play HTML (or the reverse). Query
    // parameters such as ?perf=1 share the game shell, not a saved runtime.
    const shellKey = /^\/play(?:\/|$)/.test(url.pathname) ? "/play/" : "/";
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(shellKey, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(shellKey)));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    });
  }));
});
