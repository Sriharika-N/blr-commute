// api/cron.js
import webpush from 'web-push';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxKv69yVIxuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U0';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EE9t2m_g-fL5-5WbWqOaH8z9L9fQ6Dk5sC1jJ8nK6qE';

webpush.setVapidDetails(
  'mailto:alerts@blr-commute.app',
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

export default async function handler(req, res) {
  const isTest = req.query.test === 'true';
  const targetEmail = req.query.email ? String(req.query.email).trim() : null;

  const authHeader = req.headers['authorization'];
  if (!isTest && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const fetchRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?alerts_enabled=eq.true`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const plans = await fetchRes.json();

  if (!Array.isArray(plans) || !plans.length) {
    return res.status(200).json({ message: 'No registered plans found' });
  }

  const now = new Date();
  const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dispatched = [];

  for (const plan of plans) {
    if (!plan.push_subscription) continue;
    if (targetEmail && plan.user_email !== targetEmail) continue;

    const mapsLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;

    // Instant manual test trigger
    if (isTest) {
      const payload = JSON.stringify({
        title: '🚨 BLR Commute Alert: Time to Depart',
        body: `Optimal Departure: ${plan.leave_home_time}. Corridor crawl building—tap to open route.`,
        url: mapsLink
      });

      await webpush.sendNotification(plan.push_subscription, payload).catch(e => console.warn(e.message));
      dispatched.push({ user: plan.user_email, status: 'test_notification_sent' });
      continue;
    }

    // Scheduled routine evaluation
    if (plan.day_of_week !== currentDay || plan.is_wfh) continue;

    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const depMinutes = th * 60 + tm;
    const diff = depMinutes - currentMinutes;

    // Trigger 20-35 mins before departure
    if (diff >= 20 && diff <= 35) {
      const payload = JSON.stringify({
        title: `🚨 Time to Depart for ${plan.dest_name}`,
        body: `Optimal window: ${formatMinutesTo12(depMinutes)} (±7m). Leaving later adds +25 mins crawl time!`,
        url: mapsLink
      });

      await webpush.sendNotification(plan.push_subscription, payload).catch(e => console.warn(e.message));
      dispatched.push({ user: plan.user_email, status: 'morning_push_dispatched' });
    }
  }

  return res.status(200).json({ success: true, count: dispatched.length, dispatched });
}

function formatMinutesTo12(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
