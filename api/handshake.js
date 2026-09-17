// api/handshake.js
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, phone, waKey, fromName, toName, fc, tc, mode, weekSchedule } = req.body;

    if (!email || !phone || !waKey || !fc || !tc) {
      return res.status(400).json({ error: 'Missing required configuration fields' });
    }

    const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
    const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

    // 1. Calculate Real Road Vector via OSRM (with safety timeout)
    const profile = mode === 'bike' ? 'bike' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${fc[0]},${fc[1]};${tc[0]},${tc[1]}?overview=false`;
    
    let distKm = '12.0';
    let cleanMinutes = 25;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const oRes = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      const oData = await oRes.json();
      if (oData.routes && oData.routes.length) {
        distKm = (oData.routes[0].distance / 1000).toFixed(1);
        cleanMinutes = Math.round(oData.routes[0].duration / 60);
      }
    } catch (err) {
      console.warn('OSRM request timed out, using fallback metrics:', err.message);
    }

    // 2. Fetch Live Weather Safely
    let weatherText = 'Clear & Dry';
    try {
      const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=precipitation&timezone=Asia/Kolkata');
      const wData = await wRes.json();
      const rain = wData.current?.precipitation || 0;
      weatherText = rain > 2 ? `Rain Active (${rain}mm/hr) - Expect +15m delay` : 'Clear & Dry';
    } catch (e) {}

    // 3. Build Day-by-Day Records
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const safeSchedule = weekSchedule || {};
    
    const records = days.map((day, idx) => {
      const dayConf = safeSchedule[day] || { arrive: '09:30', return: '18:30', isWFH: false };
      const [ah, am] = (dayConf.arrive || '09:30').split(':').map(Number);
      const arrMins = (ah || 9) * 60 + (am || 30);

      // Wednesday historical worst-day multiplier
      const dayMult = idx === 2 ? 1.85 : 1.65;
      const peakEst = Math.round(cleanMinutes * dayMult) + (mode === 'cab' ? 7 : 0);
      const startMins = arrMins - peakEst;

      return {
        user_email: email,
        day_of_week: day,
        origin_name: fromName,
        origin_lat: fc[1],
        origin_lng: fc[0],
        dest_name: toName,
        dest_lat: tc[1],
        dest_lng: tc[0],
        leave_home_time: formatMinutesTo24(startMins),
        leave_office_time: dayConf.return || '18:30',
        phone: String(phone).replace(/[^0-9]/g, ''),
        whatsapp_apikey: waKey,
        is_wfh: Boolean(dayConf.isWFH),
        vehicle_mode: mode,
        alerts_enabled: true
      };
    });

    // 4. Clean old entries and insert into Supabase
    await fetch(`${supabaseUrl}/rest/v1/commute_plans?user_email=eq.${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });

    const sbRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(records)
    });

    if (!sbRes.ok) {
      const errText = await sbRes.text();
      console.error('Supabase write error:', errText);
      return res.status(500).json({ error: 'Supabase table error: ' + errText });
    }

    // 5. Build Clean WhatsApp Message
    const todayRecord = records[0];
    const depTimeDisplay = formatMinutesTo12(parseTimeToMinutes(todayRecord.leave_home_time));
    const mapsLink = `https://maps.google.com/?saddr=${fc[1]},${fc[0]}&daddr=${tc[1]},${tc[0]}`;

    const cleanMessage = 
`✅ *BLR COMMUTE RADAR: ACTIVATED*

📍 *Route:* ${fromName} ➔ ${toName}
🛣️ *Distance:* ${distKm} km (~${cleanMinutes}m off-peak)

🎯 *Recommended Departure:* ${depTimeDisplay}
⏱️ *Expected Travel Window:* ${cleanMinutes + 10} to ${cleanMinutes + 25} mins
🌧️ *Weather:* ${weatherText}

_Automated briefings will trigger 30 mins before your commute window every weekday morning._

🔗 Route in Maps: ${mapsLink}`;

    // 6. Fire WhatsApp CallMeBot (Background asynchronous dispatch)
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    const callMeBotUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(cleanMessage)}&apikey=${waKey}`;
    
    fetch(callMeBotUrl).catch(e => console.warn('CallMeBot dispatch warning:', e));

    return res.status(200).json({
      success: true,
      distKm,
      cleanMinutes,
      todayDeparture: depTimeDisplay,
      arrivalRange: `${cleanMinutes + 10} - ${cleanMinutes + 25} mins`,
      weather: weatherText
    });

  } catch (globalErr) {
    console.error('Unhandled server error in handshake:', globalErr);
    return res.status(500).json({ error: 'Internal Server Error: ' + globalErr.message });
  }
}

function parseTimeToMinutes(t) {
  const [h, m] = (t || '08:00').split(':').map(Number);
  return (h || 8) * 60 + (m || 0);
}

function formatMinutesTo24(mins) {
  const safeMins = Math.max(0, mins);
  const h = Math.floor(safeMins / 60) % 24;
  const m = safeMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatMinutesTo12(mins) {
  const safeMins = Math.max(0, mins);
  const h = Math.floor(safeMins / 60) % 24;
  const m = safeMins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}
