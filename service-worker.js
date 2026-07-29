// Baloto Quantum — Service Worker
// La app se cachea para funcionar sin señal, pero baloto.json SIEMPRE
// se pide a la red: si se cacheara, volveríamos al problema de datos viejos.
const VERSION = 'bq-v32';
const CACHE = VERSION + '-cache';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Datos: siempre red primero, nunca servir una copia vieja en silencio.
  if (url.pathname.endsWith('baloto.json')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request)));
    return;
  }

  // App: cache primero (arranque instantáneo) y refresco en segundo plano.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const red = fetch(e.request).then(r => {
          if (r && r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        }).catch(() => hit);
        return hit || red;
      })
    );
  }
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
