// public/sw.js
self.addEventListener('push', function(event) {
  if (!event.data) return;

  const data = event.data.json();
  const title = data.title || '🚨 BLR Commute Alert';
  const options = {
    body: data.body || 'Time to depart for your corridor commute!',
    icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || 'https://maps.google.com'
    },
    actions: [
      { action: 'open_maps', title: '🗺️ Open Navigation' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'https://maps.google.com';
  event.waitUntil(clients.openWindow(targetUrl));
});
