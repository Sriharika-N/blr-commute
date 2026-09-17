// api/cron.js
export default async function handler(req, res) {
  const isTest = req.query.test === 'true';
  const targetPhone = req.query.phone ? String(req.query.phone).replace(/[^0-9]/g, '') : null;

  const authHeader = req.headers['authorization'];
  if (!isTest && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const twilioSid = process.env.TWILIO_ACCOUNT_SID || 'ACe1b417671f16134c0da4162dac193d39';
  const twilioToken = process.env.TWILIO_AUTH_TOKEN || '643362f522ed57db57edd48251cbdce1';
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER || '+17372508034';

  const weather = await getBengaluruWeather();

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
    if (targetPhone && plan.phone !== targetPhone) continue;

    // In test mode, bypass time checks completely and fire immediately!
    if (isTest) {
      const mapsLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;
      const rainWarning = weather.isRaining ? `🌧️ *Rain Alert:* ${weather.rain}mm/hr active (+${weather.delayAdd}m delay)\n\n` : '';

      const testMsg = 
`🚨 *[TEST DISPATCH] BLR COMMUTE RADAR*

${rainWarning}📍 *Route:* ${plan.origin_name} ➔ ${plan.dest_name}
🎯 *Target Departure:* ${plan.leave_home_time}
⏱️ *Expected Travel Window:* 35 to 48 mins

💡 *Corridor Traffic:* Peak build-up detected. Depart within 10 mins to bypass chokepoint delays.

🔗 Live Route: ${mapsLink}

_Reply *1* or *YES* to log your test commute!_`;

      await sendTwilio(twilioSid, twilioToken, twilioFrom, plan.phone, testMsg);
      dispatched.push({ user: plan.user_email, phone: plan.phone, status: 'test_alert_sent' });
      continue;
    }

    // Normal production cron schedule checks
    if (plan.day_of_week !== currentDay || plan.is_wfh || !plan.phone) continue;

    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const depMinutes = th * 60 + tm;
    const diff = depMinutes - currentMinutes;

    if (diff >= 20 && diff <= 40) {
      const mapsLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;
      const rainWarning = weather.isRaining ? `🌧️ *Rain Alert:* ${weather.rain}mm/hr active (+${weather.delayAdd}m delay)\n\n` : '';

      const alertMsg = 
`🚨 *BLR COMMUTE ALERT: TIME TO DEPART*

${rainWarning}📍 *Route:* ${plan.origin_name} ➔ ${plan.dest_name}
🎯 *Optimal Departure:* ${formatMinutesTo12(depMinutes)} (±7 mins window)
⏱️ *Expected Travel Time:* 35 to 48 mins

🔗 Live Route: ${mapsLink}

_Reply *1* or *YES* when you leave!_`;

      await sendTwilio(twilioSid, twilioToken, twilioFrom, plan.phone, alertMsg);
      dispatched.push({ type: 'morning_alert', user: plan.user_email });
    }
  }

  return res.status(200).json({ success: true, count: dispatched.length, dispatched });
}

async function sendTwilio(sid, token, fromNumber, toPhone, message) {
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
  } catch (e) {
    console.error('Twilio dispatch error:', e);
  }
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

function formatMinutesTo12(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
