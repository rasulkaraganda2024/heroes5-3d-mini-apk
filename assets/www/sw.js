const CACHE_NAME = 'homm5-3d-mini-pwa-v3.0.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/homm5_royal.css',
  './css/homm5_royal.css?v=3.0.0',
  './js/vendor/three.min.js',
  './js/homm5_contract.js',
  './js/homm5_contract.js?v=3.0.0',
  './js/tactical_atb_core.js',
  './js/tactical_atb_core.js?v=3.0.0',
  './js/world3d_engine.js',
  './js/world3d_engine.js?v=3.0.0',
  './js/ui_audio_save_ru.js',
  './js/ui_audio_save_ru.js?v=3.0.0',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.apk')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html')))
  );
});
