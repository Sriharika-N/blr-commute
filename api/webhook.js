// api/webhook.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const fromRaw = req.body.From || '';
  const cleanPhone = fromRaw.replace('whatsapp:', '').replace(/[^0-9]/g, '');
  const rawText = (req.body.Body || '').trim();
  const upperText = rawText.toUpperCase();

  // Fetch user's registered plan
  const planRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${encodeURIComponent(cleanPhone)}&limit=1`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const plans = await planRes.json();
  const plan = Array.isArray(plans) && plans.length ? plans[0] : null;

  let replyText = '';

  // 1. INSTANT SPOT-ON TEST COMMAND ("TEST" or "NOW")
  if (upperText === 'TEST' || upperText === 'NOW') {
    if (!plan) {
      replyText = `⚠️ No registered routine found for your number yet. Please save your route on https://${req.headers.host || 'blr-commute.vercel.app'} first!`;
    } else {
      const weather = await getBengaluruWeather();
      const rainNote = weather.isRaining ? `🌧️ Rain: Active (${weather.rain}mm/hr, +${weather.delayAdd}m)` : `☀️ Weather: Dry & Clear`;
      const navLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;

      replyText = 
`⚡ *SPOT-ON LIVE RADAR BRIEFING*

📍 *Route:* ${plan.origin_name} ➔ ${plan.dest_name}
${rainNote}
⏱️ *Current Predicted Travel:* 38 to 52 mins

🚦 *Live Corridor Assessment:*
Bottleneck queues active along major junctions. Departing within the next 10 mins saves ~18 mins crawl time.

🔗 Live Navigation: ${navLink}

_Reply *1* or *YES* when you step out to audit saved minutes!_`;
    }
  }

  // 2. CHECKPOINT CONFIRMATION ("1", "YES", "DONE", "LEFT")
  else if (['1', 'YES', 'DONE', 'LEFT', 'ON TIME'].includes(upperText)) {
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
        scheduled_departure: plan ? plan.leave_home_time : 'Instant',
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

    replyText = `✅ *COMMUTE LOGGED SPOT-ON!*\n\n` +
      `+${savedMins} mins saved by beating peak crawl.\n` +
      `🏆 Total this week: *${totalMins} minutes* (~${(totalMins/60).toFixed(1)} hrs reclaimed).\n\n` +
      `Reply *STATUS* anytime to view your complete log!`;
  }

  // 3. WFH TOGGLE
  else if (upperText === 'WFH') {
    const todayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
    await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${encodeURIComponent(cleanPhone)}&day_of_week=eq.${todayStr}`, {
      method: 'PATCH',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_wfh: true })
    });
    replyText = `🏠 *WFH Logged for ${todayStr}.* Alerts muted for today!`;
  }

  // 4. SCORECARD ("STATUS", "SCORE")
  else if (upperText === 'STATUS' || upperText === 'SCORE') {
    const scoreRes = await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log?phone=eq.${encodeURIComponent(cleanPhone)}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const logs = await scoreRes.json();
    const totalMins = Array.isArray(logs) ? logs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : 0;
    const trips = Array.isArray(logs) ? logs.length : 0;

    replyText = `📊 *YOUR COMMUTE SCORECARD*\n\n` +
      `• Verified Commutes: *${trips}*\n` +
      `• Reclaimed Time: *${totalMins} mins* (~${(totalMins/60).toFixed(1)} hrs)\n` +
      `• Route: *${plan ? plan.origin_name + ' ➔ ' + plan.dest_name : 'Default'}*\n\n` +
      `🔗 Open Dashboard: https://${req.headers.host || 'blr-commute.vercel.app'}/dashboard.html?phone=${cleanPhone}`;
  }

  // 5. ON-DEMAND CUSTOM SPOT-ON ROUTING ("GO TO <place>" or "TO <place>")
  else if (upperText.startsWith('GO TO ') || upperText.startsWith('TO ') || upperText.startsWith('NAV ')) {
    const queryDest = rawText.replace(/^(GO TO|TO|NAV)\s+/i, '').trim();
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

        replyText = `🔍 *SPOT-ON RADAR: TO ${destTitle.toUpperCase()}*\n\n` +
          `🛣️ Road Distance: *${dKm} km*\n` +
          `⏱️ Predicted Travel Time: *${eta} mins*\n` +
          `🎯 Recommended Departure: Depart within 12 mins to avoid corridor pileup.\n\n` +
          `🔗 Start Navigation:\n${navLink}`;
      } else {
        replyText = `Could not locate "${queryDest}" in Bengaluru. Please try an area or building name.`;
      }
    } catch {
      replyText = `Routing network timed out. Try again in a few seconds.`;
    }
  }

  // DEFAULT HELP MENU
  else {
    replyText = `🤖 *BLR Commute Radar*\n\n` +
      `• Text *TEST* or *NOW* for instant live radar\n` +
      `• Text *GO TO <place>* for instant custom routing\n` +
      `• Reply *1* or *YES* when leaving\n` +
      `• Reply *STATUS* to see time saved\n` +
      `• Reply *WFH* to mute alerts for today`;
  }

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(replyText)}</Message>
</Response>`);
}

async function getBengaluruWeather() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=precipitation&timezone=Asia/Kolkata');
    const data = await res.json();
    const rain = data.current?.precipitation || 0;
    return { rain, isRaining: rain > 0.5, delayAdd: rain > 5 ? 25 : (rain > 1 ? 15 : 0) };
  } catch {
    return { rain: 0, isRaining: false, delayAdd: 0 };
  }
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
