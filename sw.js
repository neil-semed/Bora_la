const CACHE_NAME = 'bora-la-v3';
const urlsToCache = [
  './',
  './index.html',
  './app.html',
  './app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(urlsToCache)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Estratégia por tipo de arquivo:
// - HTML e JS (código do app): "network-first" -> sempre tenta buscar a versão mais
//   nova no servidor primeiro; só usa o cache se estiver offline. Isso evita o problema
//   de o navegador ficar "preso" numa versão antiga do app.js depois de uma correção.
// - Demais arquivos (ícones, manifest): "cache-first", como antes (mudam raramente).
const NETWORK_FIRST = ['/index.html', '/app.html', '/app.js', '/'];

function isNetworkFirst(url) {
  const path = new URL(url).pathname;
  return NETWORK_FIRST.some((suffix) => path === suffix || path.endsWith(suffix));
}

self.addEventListener('fetch', (e) => {
  if (isNetworkFirst(e.request.url)) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
