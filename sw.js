// Service worker : permet d'installer l'application et de l'ouvrir même avec une connexion faible.
// Stratégie « réseau d'abord » : la dernière version publiée est toujours chargée quand Internet est disponible.
const CACHE = "at-app-20261124174607";
const SHELL = ["./", "index.html", "config.js", "standalone.js", "manifest.webmanifest", "logo.png", "icon-192.png", "icon-512.png", "pdf-lib.min.js", "jszip.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Supabase et CDN : jamais mis en cache ici
  // Requête refaite par adresse : une requête de navigation ne peut pas être copiée avec des options (sinon la vieille copie était servie).
  e.respondWith(fetch(u.href,{cache:"no-cache",credentials:"same-origin"}).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match("index.html"))));
});
