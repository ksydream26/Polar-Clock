'use strict';

// Cache Storage is shared by all apps on an origin. Keep subpath apps separate.
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = `polar-clock:${encodeURIComponent(SCOPE_URL.pathname)}:`;
const VERSION = '230adbdeaa9f964f';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const APP_FILES = [
  './index.html',
  './PolarClock.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './data/korea-places.json'
];
const appURL = (relative) => new URL(relative, self.registration.scope).href;
const NAVIGATION_ALIASES = [appURL('./'), appURL('./index.html'), appURL('./PolarClock.html')];

async function isValidAppResource(url, response) {
  if (!response?.ok || response.redirected || !['basic', 'default'].includes(response.type)) return false;
  if (response.url && new URL(response.url).origin !== SCOPE_URL.origin) return false;
  const pathname = new URL(url).pathname;
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (NAVIGATION_ALIASES.includes(url)) {
    if (mime !== 'text/html') return false;
    // Auth middleware can return its login HTML with HTTP 200 and no redirect.
    // Only the real application document carries this marker on its html tag.
    return /<html\b[^>]*\bdata-polar-clock-shell\s*=\s*(['"])1\1/i.test(await response.text());
  }
  if (pathname.endsWith('/data/korea-places.json')) {
    if (mime !== 'application/json') return false;
    const data = await response.json();
    if (!Array.isArray(data?.columns) || !Array.isArray(data?.places) || !data.places.length) return false;
    const nameIndex = data.columns.indexOf('name');
    const latitudeIndex = data.columns.indexOf('latitude');
    const longitudeIndex = data.columns.indexOf('longitude');
    return [nameIndex, latitudeIndex, longitudeIndex].every((index) => index >= 0) && data.places.every((row) =>
      Array.isArray(row) && typeof row[nameIndex] === 'string' && row[nameIndex].trim()
      && Number.isFinite(row[latitudeIndex]) && Math.abs(row[latitudeIndex]) <= 90
      && Number.isFinite(row[longitudeIndex]) && Math.abs(row[longitudeIndex]) <= 180);
  }
  if (pathname.endsWith('/manifest.webmanifest')) {
    if (!['application/manifest+json', 'application/json'].includes(mime)) return false;
    const manifest = await response.json();
    if (!manifest || !manifest.name || !Array.isArray(manifest.icons)
      || !NAVIGATION_ALIASES.includes(new URL(manifest.start_url || './', SCOPE_URL).href)) return false;
    return [192, 512].every((size) => manifest.icons.some((icon) => icon.type === 'image/png'
      && String(icon.sizes).split(/\s+/).includes(`${size}x${size}`)
      && new URL(icon.src, SCOPE_URL).href === appURL(`./icons/icon-${size}.png`)));
  }
  if (pathname.endsWith('.png')) {
    if (mime !== 'image/png') return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 24 || [137,80,78,71,13,10,26,10].some((value, index) => bytes[index] !== value)) return false;
    if (String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') return false;
    const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = pathname.endsWith('icon-192.png') ? 192 : pathname.endsWith('icon-512.png') ? 512 : 180;
    return dimensions.getUint32(16) === size && dimensions.getUint32(20) === size;
  }
  if (pathname.endsWith('.svg')) {
    if (mime !== 'image/svg+xml') return false;
    return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b[\s\S]*<\/svg\s*>\s*$/i.test(await response.text());
  }
  return false;
}

async function isOfflineReady() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const checks = await Promise.all([...APP_FILES.map(appURL), appURL('./')].map(async (url) =>
      isValidAppResource(url, await cache.match(url))));
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

async function reportReady() {
  if (!(await isOfflineReady())) return;
  await notifyClients({ type: 'OFFLINE_READY', ready: true, version: VERSION });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // Cache misses reject installation instead of reporting a false success.
      await cache.addAll(APP_FILES.map((filename) => new Request(appURL(filename), { cache: 'reload' })));
      // A home-screen launch or a browser reload can use either document URL.
      // Copy the known app shell instead of fetching a separate root document.
      await cache.put(appURL('./'), await cache.match(appURL('./index.html')));
      if (!(await isOfflineReady())) throw new Error('Offline app cache is incomplete');
      await self.skipWaiting();
    } catch (error) {
      await notifyClients({ type: 'OFFLINE_ERROR', ready: false, reason: 'cache-install-failed', version: VERSION }).catch(() => {});
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!(await isOfflineReady())) throw new Error('Offline app cache is incomplete');
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
    await reportReady();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'GET_OFFLINE_STATUS') return;
  event.waitUntil((async () => {
    const ready = await isOfflineReady();
    const message = { type: 'OFFLINE_STATUS', ready, version: VERSION };
    if (event.ports?.[0]) event.ports[0].postMessage(message);
    else event.source?.postMessage(message);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const requestURL = new URL(request.url);
  if (request.method !== 'GET' || requestURL.origin !== SCOPE_URL.origin || !requestURL.pathname.startsWith(SCOPE_URL.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate' && NAVIGATION_ALIASES.some((url) => new URL(url).pathname === requestURL.pathname)) {
      // The app is a single document: use the verified local shell immediately.
      const shell = await cache.match(appURL('./index.html'));
      if (shell) return shell;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch {
      return new Response('This file is not available offline. Reopen the app once to prepare it.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
