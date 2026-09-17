// api/cron.js
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.BLR_SB_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLR_SB_KEY;
  const pushoverAppToken = process.env.PUSHOVER_APP_TOKEN; // Set this in Vercel

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials missing' });
  }

  const weather = await getBengaluruWeather();

  const fetchRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?alerts_enabled=eq.true`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  const plans = await fetchRes.json();

  if (!Array.isArray(plans) || !plans.length) {
    return res.status(200).json({ message: 'No registered plans found' });
  }

  const now = new Date();
  const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Friday Evening 5:00 PM Scorecard
  if (currentDay === 'Friday' && currentMinutes >= 1020 && currentMinutes <= 1050) {
    const digestResult = await processFridayDigest(plans, supabaseUrl, supabaseKey, pushoverAppToken);
    return res.status(200).json({ mode: 'friday_digest', ...digestResult });
  }

  const dispatched = [];

  for (const plan of plans) {
    if (plan.day_of_week !== currentDay || !plan.pushover_user_key) continue;

    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const targetMinutes = th * 60 + tm;
    const diff = targetMinutes - currentMinutes;

    // Trigger window: 20-45 minutes before departure
    if (diff < 20 || diff > 45) continue;

    // 1. Fetch road duration from OSRM
    const profile = plan.vehicle_mode === 'bike' ? 'bike' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${plan.origin_lng},${plan.origin_lat};${plan.dest_lng},${plan.dest_lat}?overview=false`;
    
    let baseMinutes = 25;
    try {
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();
      if (osrmData.routes && osrmData.routes.length) {
        baseMinutes = Math.round(osrmData.routes[0].duration / 60);
      }
    } catch (e) {}

    // 2. Evaluate Arbitrage Curve
    const deltas = [-30, -15, 0, 15, 30, 60, 90];
    const curve = deltas.map(offset => {
      const evalMin = targetMinutes + offset;
      const evalHour = evalMin / 60;
      const multiplier = getBangaloreMultiplier(evalHour, now.getDay(), plan.vehicle_mode, weather.rain);
      return {
        offset,
        timeStr: formatMinutesToTime(evalMin),
        eta: Math.round(baseMinutes * multiplier) + (plan.vehicle_mode === 'cab' ? 7 : 0)
      };
    });

    const baseline = curve.find(c => c.offset === 0);
    const minOption = curve.reduce((prev, curr) => curr.eta < prev.eta ? curr : prev, curve[0]);
    const savings = Math.max(0, baseline.eta - minOption.eta);

    if (savings > 0) {
      await logSavings(supabaseUrl, supabaseKey, plan.user_email, currentDay, savings);
    }

    // 3. Build Pushover Notification Payload
    const gmapsUrl = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;
    let title = '';
    let message = '';

    const rainText = weather.isRaining ? `🌧️ Rain Active (${weather.rain}mm/hr) - Expect +${weather.delayAdd}m delays.\n\n` : '';

    if (savings >= 18) {
      title = `🚨 High Surge Alert: Save ${savings} mins`;
      message = `${rainText}Route: ${plan.origin_name} ➔ ${plan.dest_name}\n\n` +
        `• Leave at ${minOption.timeStr} ➔ ${minOption.eta} mins (Save ${savings}m)\n` +
        `• Leave at ${baseline.timeStr} ➔ ${baseline.eta} mins`;
    } else {
      title = `✅ Normal Flow on Your Route`;
      message = `${rainText}Route: ${plan.origin_name} ➔ ${plan.dest_name}\n\n` +
        `Estimated travel time: ${baseline.eta} mins. Traffic is moving at expected baseline speeds.`;
    }

    // 4. Dispatch to Pushover API
    await sendPushoverAlert({
      token: pushoverAppToken,
      user: plan.pushover_user_key,
      title,
      message,
      url: gmapsUrl,
      url_title: 'Open in Google Maps'
    });

    dispatched.push({ user: plan.user_email, savings });
  }

  return res.status(200).json({ success: true, dispatchedCount: dispatched.length, dispatched });
}

// Pushover API Client
async function sendPushoverAlert({ token, user, title, message, url, url_title }) {
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user,
        title,
        message,
        url,
        url_title,
        sound: 'cosmic' // Distinct commute tone
      })
    });
  } catch (err) {
    console.error('Pushover dispatch error:', err);
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

function getBangaloreMultiplier(hour, day, mode, rain = 0) {
  let mult = 1.15;
  if (hour >= 8.0 && hour <= 11.0) mult = mode === 'bike' ? 1.45 : 1.95;
  else if (hour >= 17.0 && hour <= 20.5) mult = (mode === 'bike' ? 1.55 : 2.20) + (day === 3 ? 0.25 : 0);
  if (rain > 5) mult += 0.35;
  else if (rain > 1) mult += 0.20;
  return mult;
}

async function logSavings(url, key, email, day, minutes) {
  try {
    await fetch(`${url}/rest/v1/commute_savings_log`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_email: email, day_of_week: day, minutes_saved: minutes })
    });
  } catch {}
}

async function processFridayDigest(plans, url, key, pushoverAppToken) {
  const uniqueUsers = [...new Set(plans.map(p => p.user_email))];
  for (const email of uniqueUsers) {
    const plan = plans.find(p => p.user_email === email && p.pushover_user_key);
    if (!plan) continue;

    const res = await fetch(`${url}/rest/v1/commute_savings_log?user_email=eq.${encodeURIComponent(email)}`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const logs = await res.json();
    const totalMinutes = Array.isArray(logs) ? logs.reduce((sum, log) => sum + (log.minutes_saved || 0), 0) : 0;

    await sendPushoverAlert({
      token: pushoverAppToken,
      user: plan.pushover_user_key,
      title: '🏆 Your Friday Commute Scorecard',
      message: `By timing your departures around surge peaks, you reclaimed ${totalMinutes} mins (~${(totalMinutes / 60).toFixed(1)} hrs) this week.\n\nEnjoy your weekend!`
    });
  }
  return { dispatchedWeeklyScorecards: uniqueUsers.length };
}

function formatMinutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
