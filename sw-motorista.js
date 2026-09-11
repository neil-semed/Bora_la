// Service Worker mínimo, só para o app instalável do Motorista (veja motorista.html
// e manifest-motorista.json). Ele existe só para o Android considerar o site "instalável
// de verdade" (com um ícone .apk gerável pelo PWABuilder) - de propósito ele NÃO guarda
// em cache nem HTML nem app.js, pra nunca reproduzir o problema que fez a gente desligar o
// Service Worker antigo (sw.js) do app inteiro: gente presa numa versão antiga do sistema
// sem nenhum aviso disso acontecendo.
//
// Cache-first: só os ícones (que praticamente nunca mudam).
// Passthrough puro (sem cache nenhum): tudo o resto - toda página/script sempre vem
// direto do servidor, igual a não ter Service Worker nenhum.
const CACHE_NAME = 'bora-la-motorista-v1';
const ICONS_TO_CACHE = ['./assets/icon-192.png', './assets/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ICONS_TO_CACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const isIcon = ICONS_TO_CACHE.some((path) => e.request.url.endsWith(path.replace('./', '/')));
  if (isIcon) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
  // qualquer outro pedido (HTML, app.js, manifest, chamadas ao Supabase): não intercepta
  // nada - deixa ir direto pra rede, exatamente como se não houvesse Service Worker.
});
