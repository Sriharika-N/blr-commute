import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { subscription, title, body } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Missing push subscription object' });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@cruizgo.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const payload = JSON.stringify({
    title: title || '⚡ CruizGo Departure Alert',
    body: body || 'Time to depart for your corridor!'
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Web Push Dispatch Error:', err);
    if (err.statusCode === 410 || err.statusCode === 404) {
      return res.status(410).json({ error: 'Subscription expired or invalid', expired: true });
    }
    return res.status(500).json({ error: err.message });
  }
}
