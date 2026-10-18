// The service worker does two small jobs.
//
// 1. It exists. Browsers that still insist on a service worker before they will install a page as an app from
//    its manifest (Samsung Internet, older Chrome) then do so. main.js registers it only on a secure (HTTPS)
//    page, which is the other condition for installing.
//
// 2. It keeps the game fresh. Static hosts tend to give scripts and images long cache lifetimes, and an
//    installed app has no address bar to force a reload from, so after an upload a phone could carry on
//    running the old scripts for days. Every same-origin fetch for a script, image, sound or track is made with
//    `cache: 'no-cache'`, which makes the browser check with the server first: a conditional request that
//    returns the cached copy if the file is unchanged, or the new file if it isn't. Everything else is left
//    to the browser: navigations (a response built here for one has restrictions of its own, and the browser
//    revalidates the HTML anyway) and cross-origin requests (which a worker lingering on an origin after the
//    game has moved away would otherwise be blamed for when they fail). Nothing is stored by this worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  if (request.method !== 'GET' || request.mode === 'navigate' || !sameOrigin) return;   // The browser's own business
  event.respondWith(
    fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(() => fetch(request)),
  );
});
