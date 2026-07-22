const CACHE_NAME = 'newlife-pwa-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/admin.html',
  '/orders.html',
  '/css/variables.css',
  '/css/main.css',
  '/css/admin.css',
  '/js/main.js',
  '/js/admin.js',
  '/manifest.json',
  '/admin-manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/admin-icon-192x192.png',
  '/icons/admin-icon-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.log('SW cache addAll fallback:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Network first, fallback to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
