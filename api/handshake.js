// api/handshake.js
import webpush from 'web-push';

// Pre-generated standard public/private VAPID keypair for BLR Commute Radar
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxKv69yVIxuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U0';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EE9t2m_g-fL5-5WbWqOaH8z9L9fQ6Dk5sC1jJ8nK6qE';

webpush.setVapidDetails(
  'mailto:alerts@blr-commute.app',
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, subscription, fromName, toName, fc, tc, mode, weekSchedule } = req.body || {};

    if (!email || !fc || !tc) {
      return res.status(400).json({ error: 'Missing required itinerary fields' });
    }

    const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
    const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

    // 1. Calculate OSRM Clean Drive Duration
    const profile = mode === 'bike' ? 'bike' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${fc[0]},${fc[1]};${tc[0]},${tc[1]}?overview=false`;

    let distKm = '12.4';
    let cleanMinutes = 26;
    try {
      const oRes = await fetch(osrmUrl);
      if (oRes.ok) {
        const oData = await oRes.json();
        if (oData.routes && oData.routes.length) {
          distKm = (oData.routes[0].distance / 1000).toFixed(1);
          cleanMinutes = Math.round(oData.routes[0].duration / 60);
        }
      }
    } catch (e) {
      console.warn('OSRM calculation fallback active');
    }

    // 2. Hyperlocal Weather Check
    let weatherText = '☀️ Clear & Dry';
    try {
      const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=precipitation&timezone=Asia/Kolkata');
      const wData = await wRes.json();
      const rain = wData.current?.precipitation || 0;
      weatherText = rain > 1 ? `🌧️ Rain Active (${rain}mm/hr) - Expect +15m delay` : '☀️ Clear & Dry';
    } catch (e) {}

    // 3. Build 5-Day Mon-Fri Itinerary
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const safeSched = weekSchedule || {};

    const records = days.map((day, idx) => {
      const conf = safeSched[day] || { arrive: '09:30', return: '18:30', isWFH: false };
      const [ah, am] = (conf.arrive || '09:30').split(':').map(Number);
      const arrMins = (ah || 9) * 60 + (am || 30);

      const surgeMultiplier = idx === 2 ? 1.85 : 1.65;
      const peakETA = Math.round(cleanMinutes * surgeMultiplier);
      const depMins = Math.max(0, arrMins - peakETA);

      const h = Math.floor(depMins / 60) % 24;
      const m = depMins % 60;
      const leaveHomeTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      return {
        user_email: email,
        phone: email, // Reused unique identifier
        day_of_week: day,
        origin_name: fromName || 'Home',
        origin_lat: Number(fc[1]),
        origin_lng: Number(fc[0]),
        dest_name: toName || 'Office',
        dest_lat: Number(tc[1]),
        dest_lng: Number(tc[0]),
        leave_home_time: leaveHomeTime,
        leave_office_time: conf.return || '18:30',
        is_wfh: Boolean(conf.isWFH),
        vehicle_mode: mode || 'car',
        alerts_enabled: true,
        push_subscription: subscription || null
      };
    });

    // 4. Save to Supabase
    await fetch(`${supabaseUrl}/rest/v1/commute_plans?user_email=eq.${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });

    await fetch(`${supabaseUrl}/rest/v1/commute_plans`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(records)
    });

    const todayRecord = records[0];
    const [th, tm] = todayRecord.leave_home_time.split(':').map(Number);
    const depTimeDisplay = `${th % 12 || 12}:${String(tm).padStart(2, '0')} ${th >= 12 ? 'PM' : 'AM'}`;
    const mapsLink = `https://maps.google.com/?saddr=${fc[1]},${fc[0]}&daddr=${tc[1]},${tc[0]}`;

    // 5. Send an Instant Push Notification Test to the Phone/Screen
    if (subscription) {
      const pushPayload = JSON.stringify({
        title: '✅ Commute Radar Activated',
        body: `Rec. Departure: ${depTimeDisplay} (${distKm} km, ~${cleanMinutes}m clean). Alerts are armed!`,
        url: mapsLink
      });

      webpush.sendNotification(subscription, pushPayload).catch(e => console.warn('Instant push note:', e.message));
    }

    return res.status(200).json({
      success: true,
      distKm,
      cleanMinutes,
      todayDeparture: depTimeDisplay,
      arrivalRange: `${cleanMinutes + 10} - ${cleanMinutes + 25} mins`,
      weather: weatherText
    });

  } catch (err) {
    console.error('Handshake failure:', err);
    return res.status(500).json({ error: 'Server exception: ' + err.message });
  }
}
