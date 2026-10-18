// A minimal service worker. It exists only so that browsers which still insist on one before they will install
// a page as an app from its manifest (Samsung Internet, older Chrome) will do so. It caches nothing: every
// request goes to the network as usual, so a freshly uploaded version is always what's played. main.js registers
// it only on a secure (HTTPS) page, which is the other condition for installing.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// A genuine pass-through, not an empty handler: Chromium-based browsers treat an empty fetch handler as no
// handler at all when deciding whether the page can be installed
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
