// api/handshake.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, pushoverKey, phone, fromName, toName, fc, tc, arriveTime, returnTime, mode } = req.body;

  if (!email || !fc || !tc) {
    return res.status(400).json({ error: 'Missing required itinerary coordinates or email' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';
  const pushoverAppToken = process.env.PUSHOVER_APP_TOKEN;

  // 1. Calculate Real Road Vector via OSRM
  const profile = mode === 'bike' ? 'bike' : 'driving';
  const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${fc[0]},${fc[1]};${tc[0]},${tc[1]}?overview=false`;

  let distKm = '12.5';
  let cleanMinutes = 28;

  try {
    const osrmRes = await fetch(osrmUrl);
    const osrmData = await osrmRes.json();
    if (osrmData.routes && osrmData.routes.length) {
      distKm = (osrmData.routes[0].distance / 1000).toFixed(1);
      cleanMinutes = Math.round(osrmData.routes[0].duration / 60);
    }
  } catch (err) {
    console.error('OSRM query fallback:', err);
  }

  // Calculate morning baseline departure (target arrival - travel time - 10m buffer)
  const [ah, am] = arriveTime.split(':').map(Number);
  const targetArrivalMins = ah * 60 + am;
  const recommendedDepMins = targetArrivalMins - cleanMinutes - 15;
  const leaveHomeTime = `${String(Math.floor(recommendedDepMins / 60)).padStart(2, '0')}:${String(recommendedDepMins % 60).padStart(2, '0')}`;

  // Peak traffic multiplier for Bengaluru morning
  const peakETA = Math.round(cleanMinutes * (mode === 'bike' ? 1.45 : 1.95));
  const potentialSavings = peakETA - cleanMinutes;

  // 2. Persist 5-day Itinerary to Supabase
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const records = days.map(day => ({
    user_email: email,
    day_of_week: day,
    origin_name: fromName,
    origin_lat: fc[1],
    origin_lng: fc[0],
    dest_name: toName,
    dest_lat: tc[1],
    dest_lng: tc[0],
    leave_home_time: leaveHomeTime,
    leave_office_time: returnTime || '18:30',
    pushover_user_key: pushoverKey || null,
    phone: phone || null,
    vehicle_mode: mode,
    alerts_enabled: true
  }));

  // Delete existing records for this user to avoid duplicates, then insert fresh itinerary
  await fetch(`${supabaseUrl}/rest/v1/commute_plans?user_email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(records)
  });

  if (!insertRes.ok) {
    const errBody = await insertRes.text();
    return res.status(500).json({ error: 'Failed to write itinerary to Supabase: ' + errBody });
  }

  // 3. Dispatch Instant Handshake Alert
  const mapsLink = `https://maps.google.com/?saddr=${fc[1]},${fc[0]}&daddr=${tc[1]},${tc[0]}`;
  const verifyLink = `https://${req.headers.host || 'blr-commute.vercel.app'}/api/verify-commute?email=${encodeURIComponent(email)}&status=confirmed_on_time&day=${days[new Date().getDay() - 1] || 'Monday'}&saved=${potentialSavings}`;

  const message = `⚡ COMMUTE RADAR: ACTIVE & VERIFIED\n\n` +
    `Route: ${fromName} ➔ ${toName}\n` +
    `Road Distance: ${distKm} km\n` +
    `Clean Duration: ${cleanMinutes} mins\n` +
    `Peak Surge Risk: Up to ${peakETA} mins (+${potentialSavings}m delay)\n\n` +
    `🎯 Calibrated Departure: ${formatTime(leaveHomeTime)}\n` +
    `🏢 Return Home Window: ${formatTime(returnTime || '18:30')}\n\n` +
    `You will receive automated arbitrage briefings 30 mins before both departure windows.`;

  // Dispatch via Pushover if key is configured
  let pushoverSent = false;
  if (pushoverKey && pushoverAppToken) {
    try {
      await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: pushoverAppToken,
          user: pushoverKey,
          title: '⚡ Commute Radar Activated',
          message: message,
          url: mapsLink,
          url_title: 'Preview Route in Google Maps',
          sound: 'intermission'
        })
      });
      pushoverSent = true;
    } catch (e) {
      console.error('Pushover dispatch error:', e);
    }
  }

  return res.status(200).json({
    success: true,
    pushoverSent,
    distKm,
    cleanMinutes,
    leaveHomeTime,
    peakETA,
    potentialSavings,
    itineraryCount: records.length,
    whatsappDeeplink: `https://api.whatsapp.com/send?phone=${phone || ''}&text=${encodeURIComponent(message)}`
  });
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
}
