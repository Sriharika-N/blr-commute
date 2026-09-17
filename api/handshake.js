// api/handshake.js
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, phone, fromName, toName, fc, tc, mode, weekSchedule } = req.body || {};

    if (!email || !phone || !fc || !tc) {
      return res.status(400).json({ error: 'Missing required fields (email, phone, or route coordinates)' });
    }

    // Supabase Credentials
    const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
    const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';
    
    // Twilio Credentials
    const twilioSid = process.env.TWILIO_ACCOUNT_SID || 'ACe1b417671f16134c0da4162dac193d39';
    const twilioToken = process.env.TWILIO_AUTH_TOKEN || '643362f522ed57db57edd48251cbdce1';
    const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886';

    const cleanPhone = String(phone).replace(/[^0-9]/g, '');

    // 1. Calculate Real Road Driving Time via OSRM
    const profile = mode === 'bike' ? 'bike' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${fc[0]},${fc[1]};${tc[0]},${tc[1]}?overview=false`;
    
    let distKm = '12.0';
    let cleanMinutes = 25;
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

    // 2. Prepare 5-Day Mon-Fri Itinerary
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const safeSched = weekSchedule || {};

    const records = days.map((day, idx) => {
      const conf = safeSched[day] || { arrive: '09:30', return: '18:30', isWFH: false };
      const [ah, am] = (conf.arrive || '09:30').split(':').map(Number);
      const arrMins = (ah || 9) * 60 + (am || 30);

      // Wednesday has Bangalore's highest peak density (+20m buffer)
      const surgeMultiplier = idx === 2 ? 1.85 : 1.65;
      const peakETA = Math.round(cleanMinutes * surgeMultiplier);
      const depMins = Math.max(0, arrMins - peakETA);

      const h = Math.floor(depMins / 60) % 24;
      const m = depMins % 60;
      const leaveHomeTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      return {
        user_email: email,
        phone: cleanPhone,
        day_of_week: day,
        origin_name: fromName,
        origin_lat: Number(fc[1]),
        origin_lng: Number(fc[0]),
        dest_name: toName,
        dest_lat: Number(tc[1]),
        dest_lng: Number(tc[0]),
        leave_home_time: leaveHomeTime,
        leave_office_time: conf.return || '18:30',
        is_wfh: Boolean(conf.isWFH),
        vehicle_mode: mode || 'car',
        alerts_enabled: true
      };
    });

    // 3. Clear existing plan & write fresh records to Supabase
    await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${cleanPhone}`, {
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
      return res.status(500).json({ error: 'Supabase write error: ' + errText });
    }

    // 4. Construct Instant WhatsApp Briefing Message
    const todayRecord = records[0];
    const [th, tm] = todayRecord.leave_home_time.split(':').map(Number);
    const depTimeDisplay = `${th % 12 || 12}:${String(tm).padStart(2, '0')} ${th >= 12 ? 'PM' : 'AM'}`;
    const mapsLink = `https://maps.google.com/?saddr=${fc[1]},${fc[0]}&daddr=${tc[1]},${tc[0]}`;

    const confirmationMsg = 
`✅ *BLR COMMUTE RADAR: ACTIVATED*

📍 *Route:* ${fromName} ➔ ${toName}
🛣️ *Distance:* ${distKm} km (~${cleanMinutes}m clean drive)

🎯 *Recommended Departure:* ${depTimeDisplay}
⏱️ *Expected Window:* ${cleanMinutes + 10} to ${cleanMinutes + 25} mins

_You will receive traffic arbitrage briefings 30 mins before your commute window every weekday morning._

🔗 Route Preview: ${mapsLink}`;

    // 5. Dispatch via Twilio
    await sendTwilioMessage(twilioSid, twilioToken, twilioFrom, cleanPhone, confirmationMsg);

    return res.status(200).json({
      success: true,
      twilioNumber: twilioFrom,
      message: 'Plan saved and confirmation dispatched'
    });

  } catch (err) {
    console.error('Handshake failure:', err);
    return res.status(500).json({ error: 'Server exception: ' + err.message });
  }
}

async function sendTwilioMessage(sid, token, fromNumber, toPhone, message) {
  const cleanTo = toPhone.startsWith('+') ? toPhone : `+${toPhone}`;
  const cleanFrom = fromNumber.startsWith('+') ? fromNumber : `+${fromNumber}`;

  const body = new URLSearchParams({
    From: `whatsapp:${cleanFrom}`,
    To: `whatsapp:${cleanTo}`,
    Body: message
  });

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
  } catch (err) {
    console.error('Twilio dispatch exception:', err);
  }
}
