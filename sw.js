/**
 * Service Worker: Ultra Rotina Cockpit PWA
 * Cache em Camadas (Layered Caching) para abertura em 0ms mesmo offline (elevador / UTI)
 */
const CACHE_NAME = 'ultra-rotina-cockpit-v3.1';

// Camada 1: App Shell Essencial & Assets Estáticos
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  '/',
  '/cockpit',
  '/index.html',
  '/manifest.json',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  'https://telegram.org/js/telegram-web-app.js',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.11/dist/dexie.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Pré-carregamento tolerante a falhas (um CDN instável não aborta os outros)
      const promessas = PRECACHE_ASSETS.map(async (url) => {
        try {
          const req = new Request(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' });
          const res = await fetch(req);
          if (res.status === 200 || res.type === 'opaque') {
            await cache.put(url, res);
          }
        } catch (_) {
          // Fallback silencioso no pré-carregamento individual
        }
      });
      await Promise.allSettled(promessas);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Não intercepta chamadas de API, RPC ou Webhooks (dados clínicos sensíveis em tempo real)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/webhook')) {
    return;
  }

  // 2. Camada de Assets Estáticos & CDNs (Tailwind, Lucide, Chart.js, Dexie, Fontes)
  // Estratégia: Cache-First estrito com atualização em segundo plano (0ms de latência)
  const ehAssetEstatico =
    url.hostname.includes('cdn') ||
    url.hostname.includes('unpkg') ||
    url.hostname.includes('telegram.org') ||
    url.hostname.includes('jsdelivr') ||
    url.hostname.includes('fonts') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  if (ehAssetEstatico) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) {
          // Em segundo plano, busca atualização de forma não-bloqueante
          fetch(event.request).then((networkRes) => {
            if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkRes));
            }
          }).catch(() => {});
          return cached;
        }

        return fetch(event.request).then((networkRes) => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkRes;
        }).catch(() => caches.match(event.request));
      })
    );
    return;
  }

  // 3. Camada de Navegação HTML (Cockpit PWA):
  // Estratégia: Network-First com Fallback Instantâneo para Cache (Abertura garantida em 0ms offline)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkRes;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const fallbackCockpit = await caches.match('./index.html') || await caches.match('./') || await caches.match('index.html') || await caches.match('/cockpit') || await caches.match('/') || await caches.match('/index.html');
        return fallbackCockpit;
      })
    );
    return;
  }

  // 4. Fallback Geral
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((networkRes) => {
        if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkRes;
      });
    }).catch(() => caches.match(event.request))
  );
});
