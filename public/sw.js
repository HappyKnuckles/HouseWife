/**
 * Service worker for the installed web app.
 *
 * It exists for one reason: an app launched from the iPhone home screen should
 * open, not show Safari's offline page, when the tunnel/lift/basement has eaten
 * the connection. It caches the shell and the bundle — nothing else. Everything
 * that talks to Supabase goes straight to the network, always: cached household
 * data that is quietly hours old is worse than an honest error, and React Query
 * already handles the retry.
 *
 * Two strategies, chosen by what the request is:
 *
 *   navigation  → network-first, cached shell as fallback. A deploy is picked
 *                 up on the next launch rather than whenever a cache happens to
 *                 expire, which is the failure mode people actually hit ("I
 *                 pushed a fix, the phone still shows the old one").
 *   build asset → cache-first. Everything under /_expo/static and /assets has a
 *                 content hash in its name, so a given URL never changes
 *                 meaning and serving it from disk is free speed.
 *
 * Bumping CACHE drops every previous cache on activate.
 */

const CACHE = 'housewife-v1';

/** The SPA entry. Every route renders from it, so it is the only HTML there is. */
const SHELL = '/';

const PRECACHE = [SHELL, '/manifest.json', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing; a single 404 would leave the worker
      // uninstalled and the app with no offline start at all.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Hashed build output: same URL, same bytes, forever. */
function isBuildAsset(url) {
  return url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cacheable, and only our own origin is ours to serve. Supabase
  // (REST, auth, storage, realtime) falls through untouched — including the
  // Google OAuth redirect, which leaves this origin entirely.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Keep the shell fresh for the next offline launch — but only if
          // what came back is actually the app.
          //
          // `redirected` is the important half. The sign-in flow bounces
          // through Google and back, and an auth gateway in front of this
          // would bounce too; caching a login page as the shell would pin it
          // as what the app opens to, offline, until the cache version
          // changes. The Cache API refuses redirected responses anyway, so
          // without this the put() also rejects unhandled.
          if (response.ok && !response.redirected) {
            // Clone first: a body can only be read once and the page needs
            // this one.
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          }
          return response;
        })
        // Any route falls back to the shell — expo-router reads the path from
        // the URL and renders the right screen once the bundle boots.
        .catch(() => caches.match(SHELL).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (!isBuildAsset(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // `basic` excludes opaque cross-origin and error responses; caching
        // either would pin a failure in place until the next CACHE bump.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
