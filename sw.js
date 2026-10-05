const CACHE_NAME = 'nailong-run-v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './js/horizontal.js',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/laugh.png',
  './assets/laugh.mp3',
  './assets/start-meme-character.png',
  './assets/support-wechat.png',
  './assets/idle/00.png',
  './assets/idle/01.png',
  './assets/idle/02.png',
  './assets/idle/03.png',
  './assets/idle/04.png',
  './assets/idle/05.png',
  './assets/walk/00.png',
  './assets/walk/01.png',
  './assets/walk/02.png',
  './assets/walk/03.png',
  './assets/walk/04.png',
  './assets/walk/05.png',
  './assets/walk/06.png',
  './assets/walk/07.png',
  './assets/laugh/00.png',
  './assets/laugh/01.png',
  './assets/laugh/02.png',
  './assets/laugh/03.png',
  './assets/laugh/04.png',
  './assets/laugh/05.png',
  './assets/laugh/06.png',
  './assets/laugh/07.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fresh = fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
