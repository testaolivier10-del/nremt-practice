// This old copy of the site has moved to https://levlprep.com/nremt/.
// Replace any installed service worker with one that clears its caches and
// unregisters, so returning visitors stop seeing the stale cached pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
