// api/cron.js
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Supabase & Twilio credentials with fallbacks
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
  const host = req.headers.host || 'blr-commute.vercel.app';
  const dispatched = [];

  // Friday 5:00 PM Scorecard (between 17:00 and 17:35 IST)
  if (currentDay === 'Friday' && currentMinutes >= 1020 && currentMinutes <= 1055) {
    await processFridayScorecards(plans, supabaseUrl, supabaseKey, twilioSid, twilioToken, twilioFrom, host);
    return res.status(200).json({ mode: 'friday_digest', processed: true });
  }

  for (const plan of plans) {
    if (plan.day_of_week !== currentDay || plan.is_wfh || !plan.phone) continue;

    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const depMinutes = th * 60 + tm;
    const diff = depMinutes - currentMinutes;

    // 1. MORNING PRE-TRIP ARBITRAGE ALERT (20-40 mins before scheduled departure)
    if (diff >= 20 && diff <= 40) {
      const depDisplay = formatMinutesTo12(depMinutes);
      const mapsLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;
      const rainWarning = weather.isRaining ? `🌧️ *Rain Alert:* ${weather.rain}mm/hr active (+${weather.delayAdd}m delay)\n\n` : '';

      const alertMsg = 
`🚨 *BLR COMMUTE ALERT: TIME TO DEPART*

${rainWarning}📍 *Route:* ${plan.origin_name} ➔ ${plan.dest_name}
🎯 *Optimal Departure:* ${depDisplay} (±7 mins window)
⏱️ *Expected Drive Time:* 35 to 48 mins

💡 *Corridor Status:* Queue delays building. Leaving past ${formatMinutesTo12(depMinutes + 20)} will add +25 mins crawl time.

🔗 Live Navigation: ${mapsLink}

_Reply *1* or *YES* when you leave to log your saved time!_`;

      await sendTwilio(twilioSid, twilioToken, twilioFrom, plan.phone, alertMsg);
      dispatched.push({ type: 'morning_alert', user: plan.user_email });
    }

    // 2. POST-TRIP CHECKPOINT (20-35 mins after scheduled departure)
    if (diff <= -20 && diff >= -35) {
      const checkMsg = 
`⏱️ *COMMUTE CHECKPOINT*

Did you manage to depart around *${formatMinutesTo12(depMinutes)}* today?

• Reply *1* or *YES* ➔ Logs +25 mins saved
• Reply *WFH* ➔ If working from home today

_Your reply audits your weekly savings scorecard!_`;

      await sendTwilio(twilioSid, twilioToken, twilioFrom, plan.phone, checkMsg);
      dispatched.push({ type: 'checkpoint_prompt', user: plan.user_email });
    }
  }

  return res.status(200).json({ success: true, count: dispatched.length, dispatched });
}

async function processFridayScorecards(plans, url, key, sid, token, fromNum, host) {
  const uniquePhones = [...new Set(plans.map(p => p.phone))];
  for (const phone of uniquePhones) {
    const res = await fetch(`${url}/rest/v1/commute_feedback_log?phone=eq.${encodeURIComponent(phone)}`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const logs = await res.json();
    const totalMins = Array.isArray(logs) ? logs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : 0;

    const digestMsg = 
`🏆 *YOUR FRIDAY COMMUTE SCORECARD*

This week, by stepping around corridor peak crawls, you reclaimed:

⏱️ *${totalMins} Minutes* (~${(totalMins / 60).toFixed(1)} Hours)
🎉 That's valuable evening rest saved from Silk Board & ORR!

🔗 View Detailed Scorecard:
https://${host}/dashboard.html?phone=${phone}

_Rest up this weekend! Radar resumes Monday._`;

    await sendTwilio(sid, token, fromNum, phone, digestMsg);
  }
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
    console.error('Twilio cron dispatch error:', e);
  }
}

async function getBengaluruWeather() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=precipitation,temperature_2m&timezone=Asia/Kolkata');
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
