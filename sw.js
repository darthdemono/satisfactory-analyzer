// Offline support: the app does all its work locally once loaded, so caching its own files is enough.
const CACHE = "sat-analyzer-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg", "app/main.js", "app/worker.js", "app/reader.js", "app/model.js", "app/names.js",
  "app/render.js", "app/combine.js", "app/view.js", "app/mdview.js", "css/theme.css", "css/normal.css", "css/controls.css", "css/site.css", "css/document.css", "css/view.css", "db_sat/names.json", "graphics/noise.svg"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
