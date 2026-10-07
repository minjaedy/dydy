/* Cache only the offline explanation. Shared data and API calls stay on the network. */
const CACHE = 'couple-shell-v1';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./offline.html','./assets/app-icon-192.png'])));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('couple-shell-') && key !== CACHE).map(key => caches.delete(key))))]));
});
self.addEventListener('fetch', event => {
  if (event.request.url === new URL('./assets/app-icon-192.png', self.registration.scope).href) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))); return;
  }
  if (event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => caches.match('./offline.html')));
  }
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Display a generic notification. */ }
  const allowed = new Set(['home', 'calendar', 'leave', 'smoke', 'travel', 'chat']);
  const target = allowed.has(data.screen) ? data.screen : 'home';
  event.waitUntil(self.registration.showNotification(String(data.title || ({leave:'🐰 유흥연차 알림',smoke:'💨 흡연 결재 알림',calendar:'🗓 일정 알림',travel:'✈ 여행 알림'}[target]) || '🐰🍠 새 소식').slice(0, 60), {
    body: String(data.body || '우리의 새 소식이 도착했어요.').slice(0, 250),
    icon: './assets/app-icon-192.png',
    tag: String(data.tag || 'couple-update').slice(0, 120),
    data: { url: new URL('./#' + target, self.registration.scope).href }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#home', self.registration.scope);
  if (target.origin !== self.location.origin || !target.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(async windows => {
    const app = windows.find(client => client.url.startsWith(self.registration.scope));
    if (app) { await app.navigate(target.href); return app.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
