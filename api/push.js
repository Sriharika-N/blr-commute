import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  'mailto:alerts@blrcommute.in',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_email, title, body } = req.body;

  if (!user_email) {
    return res.status(400).json({ error: 'Missing user_email' });
  }

  // 1. Fetch commuter subscription from Supabase
  const { data: commuter, error } = await supabase
    .from('commute_plans')
    .select('id, push_subscription, last_alert_sent_at')
    .eq('user_email', user_email)
    .single();

  if (error || !commuter?.push_subscription) {
    return res.status(404).json({ error: 'No push subscription found' });
  }

  // 2. Prevent duplicate alerts within 4 hours
  if (commuter.last_alert_sent_at) {
    const hoursSince = (Date.now() - new Date(commuter.last_alert_sent_at).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 4) {
      return res.status(200).json({ status: 'SKIPPED_DUPLICATE' });
    }
  }

  try {
    const payload = JSON.stringify({
      title: title || 'BLR Commute Arbitrage',
      body: body || 'Time to depart for your optimal corridor window.',
      icon: '/icon-192.png'
    });

    await webpush.sendNotification(commuter.push_subscription, payload);

    await supabase
      .from('commute_plans')
      .update({ last_alert_sent_at: new Date().toISOString() })
      .eq('id', commuter.id);

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
