// NBS IPS QR Generator service worker.
//
// Strategy:
//   - Navigation requests (HTML)   -> network-first, fall back to cached shell
//   - Same-origin static assets    -> stale-while-revalidate
//   - Known CDN libraries          -> stale-while-revalidate
//   - Other cross-origin requests  -> network only, never cached
//
// Bump CACHE_VERSION when shipping breaking changes that must wipe the
// existing cache (e.g. removed paths). For ordinary deploys, the
// stale-while-revalidate path is enough — users get fresh assets within
// one visit.
const CACHE_VERSION = 'v20';
const CACHE_NAME = `qrpay-${CACHE_VERSION}`;

const SCOPE = new URL(self.registration.scope).pathname;

const SHELL = [
  SCOPE,
  SCOPE + 'index.html',
  SCOPE + 'qrcode.min.js',
  SCOPE + 'postal-codes.js',
  SCOPE + 'manifest.json',
  SCOPE + 'favicon.svg',
  SCOPE + 'favicon-96x96.png',
  SCOPE + 'apple-touch-icon.png',
  SCOPE + 'web-app-manifest-192x192.png',
  SCOPE + 'web-app-manifest-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Best-effort install: don't fail the SW if some optional asset is missing.
      Promise.all(SHELL.map((url) =>
        cache.add(url).catch(() => null)
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('qrpay-') && n !== CACHE_NAME)
           .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

// All payment-critical JS is self-hosted (see README "Security"), so we no
// longer treat any third-party CDN as cacheable. Kept for future flexibility.
function isCacheableCdn(_request) {
  return false;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || network || fetch(request);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match(SCOPE + 'index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (!isSameOrigin(request)) {
    if (isCacheableCdn(request)) {
      event.respondWith(staleWhileRevalidate(request));
    }
    return;
  }

  const isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('qrpay-')).map((n) => caches.delete(n))
      );
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)));
      if (event.source) event.source.postMessage({ type: 'CACHE_CLEARED' });
    })());
  }
});
