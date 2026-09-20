import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  'mailto:alerts@cruizgo-commute.vercel.app',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Allow OPTIONS pre-flight and POST calls
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_email, title, body } = req.body;
  if (!user_email) return res.status(400).json({ error: 'Missing user_email' });

  try {
    const { data: commuter, error } = await supabase
      .from('commute_plans')
      .select('id, push_subscription, last_alert_sent_at')
      .eq('user_email', user_email)
      .single();

    if (error || !commuter?.push_subscription) {
      return res.status(404).json({ error: 'No active push subscription found for this email' });
    }

    const payload = JSON.stringify({
      title: title || '⚡ CruizGo Departure Alert',
      body: body || 'Time to depart for your corridor. Plan ahead and beat the rush.',
      icon: '/logo.png',
      badge: '/logo.png',
      url: '/'
    });

    await webpush.sendNotification(commuter.push_subscription, payload);

    // Update timestamp to avoid duplicate spam
    await supabase
      .from('commute_plans')
      .update({ last_alert_sent_at: new Date().toISOString() })
      .eq('id', commuter.id);

    return res.status(200).json({ success: true, message: 'Delivered to lock screen' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
