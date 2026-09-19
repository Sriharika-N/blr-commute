self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  const options = {
    body: data.body || 'Time to depart for your corridor.',
    icon: '/logo.png',
    badge: '/logo.png',
    vibrate: [200, 100, 200],
    tag: 'cruizgo-departure-alert',
    renotify: true,
    data: { url: data.url || '/' }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'CruizGo Departure Alert', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
