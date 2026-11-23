// rullino tools' service worker (#178): every file of the build is cached on install, so the pages
// work offline once loaded (they never need the network: photos stay on the device). Written into
// dist/sw.js by the `offline` plugin of vite.config.ts, which fills in the file list and the version.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `rullino-tools-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new URL(f, self.registration.scope)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rullino-tools-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first (the files of a version never change), the network for anything else.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then(async (c) => {
      const url = new URL(event.request.url);
      // A page asked for without its trailing slash or index.html is the same page.
      const page = url.pathname.endsWith('/index.html') ? new URL(url.pathname.slice(0, -'index.html'.length), url) : url;
      return (await c.match(page, { ignoreSearch: true })) ?? fetch(event.request);
    }),
  );
});
