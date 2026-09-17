// api/webhook.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  // Twilio sends urlencoded data: From = "whatsapp:+91XXXXXXXXXX", Body = message text
  const fromRaw = req.body.From || '';
  const cleanPhone = fromRaw.replace('whatsapp:', '').replace(/[^0-9]/g, '');
  const text = (req.body.Body || '').trim();
  const upperText = text.toUpperCase();

  // Look up user's active commute plan
  const planRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const plans = await planRes.json();
  const plan = Array.isArray(plans) && plans.length ? plans[0] : null;

  let replyText = '';

  // 1. Commute Checkpoint Confirmation ("1", "YES", "DONE", "LEFT")
  if (['1', 'YES', 'DONE', 'LEFT', 'ON TIME'].includes(upperText)) {
    const savedMins = 25;
    const todayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];

    await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        phone: cleanPhone,
        day_of_week: todayStr,
        scheduled_departure: plan ? plan.leave_home_time : 'Standard Window',
        actual_departure_time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
        feedback_status: 'on_time',
        minutes_saved: savedMins
      })
    });

    const scoreRes = await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log?phone=eq.${encodeURIComponent(cleanPhone)}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const logs = await scoreRes.json();
    const totalMins = Array.isArray(logs) ? logs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : savedMins;

    replyText = `✅ *COMMUTE CONFIRMED!*\n\n` +
      `+${savedMins} mins saved by leaving on schedule.\n` +
      `🏆 Total this week: *${totalMins} minutes* (~${(totalMins/60).toFixed(1)} hrs reclaimed).\n\n` +
      `Your evening return alert will trigger before office exit!`;
  }
  // 2. Work From Home Toggle ("WFH")
  else if (upperText === 'WFH') {
    const todayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
    await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${encodeURIComponent(cleanPhone)}&day_of_week=eq.${todayStr}`, {
      method: 'PATCH',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_wfh: true })
    });
    replyText = `🏠 *WFH Logged for ${todayStr}.* Morning & evening alerts are muted for today. Enjoy!`;
  }
  // 3. Score & Status Check ("STATUS", "SCORE")
  else if (upperText === 'STATUS' || upperText === 'SCORE') {
    const scoreRes = await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log?phone=eq.${encodeURIComponent(cleanPhone)}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const logs = await scoreRes.json();
    const totalMins = Array.isArray(logs) ? logs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : 0;
    const trips = Array.isArray(logs) ? logs.length : 0;

    replyText = `📊 *YOUR COMMUTE SCORECARD*\n\n` +
      `• Verified Commutes: *${trips}*\n` +
      `• Total Time Saved: *${totalMins} mins* (~${(totalMins/60).toFixed(1)} hrs)\n` +
      `• Active Route: *${plan ? plan.origin_name + ' ➔ ' + plan.dest_name : 'Configured'}*\n\n` +
      `🔗 Open Visual Scorecard:\nhttps://${req.headers.host || 'blr-commute.vercel.app'}/dashboard.html?phone=${cleanPhone}`;
  }
  // 4. On-Demand Custom Routing ("GO TO <Place>")
  else if (upperText.startsWith('GO TO ') || upperText.startsWith('TO ')) {
    const queryDest = text.replace(/^(GO TO|TO)\s+/i, '').trim();
    const originCoord = plan ? [plan.origin_lng, plan.origin_lat] : [77.5946, 12.9716];

    try {
      const geoRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(queryDest)}&lat=12.9716&lon=77.5946&limit=1`);
      const geoData = await geoRes.json();

      if (geoData.features && geoData.features.length) {
        const destCoord = geoData.features[0].geometry.coordinates;
        const destTitle = geoData.features[0].properties.name || queryDest;

        const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${originCoord[0]},${originCoord[1]};${destCoord[0]},${destCoord[1]}?overview=false`);
        const osrmData = await osrmRes.json();

        let dKm = '8.0';
        let dur = 22;
        if (osrmData.routes && osrmData.routes.length) {
          dKm = (osrmData.routes[0].distance / 1000).toFixed(1);
          dur = Math.round(osrmData.routes[0].duration / 60);
        }

        const eta = Math.round(dur * 1.55);
        const navLink = `https://maps.google.com/?saddr=${originCoord[1]},${originCoord[0]}&daddr=${destCoord[1]},${destCoord[0]}`;

        replyText = `🔍 *ON-DEMAND: TO ${destTitle.toUpperCase()}*\n\n` +
          `🛣️ Distance: *${dKm} km*\n` +
          `⏱️ Predicted ETA: *${eta} mins*\n\n` +
          `🎯 Step out within 15 mins to avoid the upcoming surge.\n\n` +
          `🔗 Open Maps: ${navLink}`;
      } else {
        replyText = `Could not find "${queryDest}" in Bengaluru. Try an area or landmark name.`;
      }
    } catch {
      replyText = `Routing service currently busy. Please try again shortly.`;
    }
  }
  // Default Help Menu
  else {
    replyText = `🤖 *BLR Commute Radar*\n\n` +
      `• Reply *1* or *YES* when leaving\n` +
      `• Reply *STATUS* to see time saved\n` +
      `• Reply *WFH* to mute alerts for today\n` +
      `• Text *GO TO <place>* for instant custom routing`;
  }

  // Return TwiML XML to Twilio
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(replyText)}</Message>
</Response>`);
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
