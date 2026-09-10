// Offline support for LevlPrep. Precaches the core pages/assets so the
// site works with no connection; everything else (the 3D body-map model,
// the three.js vendor bundle, Google Fonts) is cached the first time it's
// actually requested, so a first visit isn't stuck downloading 15MB+ before
// it's usable.
//
// Pages/CSS/JS use network-first: when online, always fetch the latest
// version and update the cache, so a site update reaches every open tab on
// its next load instead of being stuck behind a stale cache indefinitely.
// The cached copy is only served as a fallback when the network fails.
// Bump CACHE_NAME whenever this file changes, so old cached entries are
// dropped instead of lingering forever.
const CACHE_NAME = 'levlprep-v5';
const PRECACHE_URLS = [
  'index.html',
  'practice.html',
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
  'tools.html',
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

const NETWORK_FIRST_EXTENSIONS = /\.(html|css|js|json)$/;

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isNetworkFirst = event.request.mode === 'navigate' || NETWORK_FIRST_EXTENSIONS.test(url.pathname);

  if(isNetworkFirst){
    event.respondWith(
      fetch(event.request).then(response => {
        if(response && response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('index.html') : undefined))
      )
    );
    return;
  }

  // Everything else (3D model, vendor JS, fonts, images): cache-first, since
  // these are large/static and don't need to be re-fetched on every visit.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(response => {
        if(response && response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
