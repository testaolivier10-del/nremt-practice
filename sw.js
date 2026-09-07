// Offline support for NREMT Prep. Precaches the core pages/assets so the
// site works with no connection; everything else (the 3D body-map model,
// the three.js vendor bundle, Google Fonts) is cached the first time it's
// actually requested, so a first visit isn't stuck downloading 15MB+ before
// it's usable.
const CACHE_NAME = 'nremt-prep-v1';
const PRECACHE_URLS = [
  'index.html',
  'body-map.html',
  'flowcharts.html',
  'glossary.html',
  'mnemonics.html',
  'scenario-sim.html',
  'skillsheets.html',
  'sound-trainer.html',
  'study-notes.html',
  'study-plan.html',
  'dashboard.html',
  'search.html',
  'manifest.json',
  'assets/theme.css',
  'assets/nav.js',
  'assets/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(response => {
        if(response && response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        // Offline and not cached: for a page navigation, fall back to the
        // homepage rather than showing the browser's default error page.
        if(event.request.mode === 'navigate') return caches.match('index.html');
      });
    })
  );
});
