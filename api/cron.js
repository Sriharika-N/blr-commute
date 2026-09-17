// api/cron.js
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';
  const pushoverAppToken = process.env.PUSHOVER_APP_TOKEN;

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

  // Friday Evening 5:00 PM Scorecard
  if (currentDay === 'Friday' && currentMinutes >= 1020 && currentMinutes <= 1050) {
    const digest = await processFridayDigest(plans, supabaseUrl, supabaseKey, pushoverAppToken);
    return res.status(200).json({ mode: 'friday_digest', ...digest });
  }

  const dispatched = [];

  for (const plan of plans) {
    if (plan.day_of_week !== currentDay) continue;

    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const targetMinutes = th * 60 + tm;
    const diff = targetMinutes - currentMinutes;

    // A. PRE-TRIP ARBITRAGE ALERT (20 to 45 mins before target departure)
    if (diff >= 20 && diff <= 45) {
      const alertPayload = await generateArbitrageAlert(plan, targetMinutes, now, weather, host);
      if (plan.pushover_user_key && pushoverAppToken) {
        await sendPushover(pushoverAppToken, plan.pushover_user_key, alertPayload.title, alertPayload.message, alertPayload.url, alertPayload.urlTitle);
        dispatched.push({ type: 'pre_trip_alert', user: plan.user_email });
      }
    }

    // B. POST-TRIP CHECKPOINT (15 to 30 mins after scheduled departure)
    if (diff <= -15 && diff >= -30) {
      const verifyUrlYes = `https://${host}/api/verify-commute?email=${encodeURIComponent(plan.user_email)}&status=confirmed_on_time&day=${currentDay}&saved=28`;
      const verifyUrlNo = `https://${host}/api/verify-commute?email=${encodeURIComponent(plan.user_email)}&status=delayed&day=${currentDay}&saved=0`;

      if (plan.pushover_user_key && pushoverAppToken) {
        await sendPushover(
          pushoverAppToken,
          plan.pushover_user_key,
          '⏱️ Commute Checkpoint',
          `Did you leave around ${formatTime(plan.leave_home_time)} today?\n\nTap below to confirm and audit your saved minutes.`,
          verifyUrlYes,
          '✓ Yes, Left On Time'
        );
        dispatched.push({ type: 'checkpoint_verification', user: plan.user_email });
      }
    }
  }

  return res.status(200).json({ success: true, count: dispatched.length, dispatched });
}

async function generateArbitrageAlert(plan, targetMinutes, now, weather, host) {
  const profile = plan.vehicle_mode === 'bike' ? 'bike' : 'driving';
  const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${plan.origin_lng},${plan.origin_lat};${plan.dest_lng},${plan.dest_lat}?overview=false`;

  let baseMinutes = 25;
  try {
    const res = await fetch(osrmUrl);
    const data = await res.json();
    if (data.routes && data.routes.length) baseMinutes = Math.round(data.routes[0].duration / 60);
  } catch (e) {}

  const deltas = [-30, -15, 0, 15, 30, 60, 90];
  const curve = deltas.map(offset => {
    const evalMin = targetMinutes + offset;
    const mult = getBangaloreMultiplier(evalMin / 60, now.getDay(), plan.vehicle_mode, weather.rain);
    return {
      offset,
      timeStr: formatMinutesToTime(evalMin),
      eta: Math.round(baseMinutes * mult) + (plan.vehicle_mode === 'cab' ? 7 : 0)
    };
  });

  const baseline = curve.find(c => c.offset === 0);
  const minOption = curve.reduce((prev, curr) => curr.eta < prev.eta ? curr : prev, curve[0]);
  const savings = Math.max(0, baseline.eta - minOption.eta);

  const rainWarning = weather.isRaining ? `🌧️ Rain Alert: ${weather.rain}mm/hr active (+${weather.delayAdd}m delay risk)\n\n` : '';
  const mapsLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;

  if (savings >= 18) {
    return {
      title: `🚨 Surge Alert: Save ${savings} mins`,
      message: `${rainWarning}Route: ${plan.origin_name} ➔ ${plan.dest_name}\n\n` +
        `• Option 1: Leave at ${minOption.timeStr} ➔ ${minOption.eta} mins (Save ${savings}m)\n` +
        `• Option 2: Leave at ${baseline.timeStr} ➔ ${baseline.eta} mins`,
      url: mapsLink,
      urlTitle: 'Open Google Maps Navigation'
    };
  } else {
    return {
      title: `✅ Steady Flow on Your Corridor`,
      message: `${rainWarning}Route: ${plan.origin_name} ➔ ${plan.dest_name}\n\n` +
        `Estimated duration: ${baseline.eta} mins. Traffic is normal; safe to depart as scheduled.`,
      url: mapsLink,
      urlTitle: 'Open Google Maps Navigation'
    };
  }
}

async function sendPushover(token, user, title, message, url, url_title) {
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, user, title, message, url, url_title, sound: 'cosmic' })
    });
  } catch (err) {
    console.error('Pushover error:', err);
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
  if (rain > 5) mult += 0.35; else if (rain > 1) mult += 0.20;
  return mult;
}

async function processFridayDigest(plans, url, key, pushoverAppToken) {
  const uniqueUsers = [...new Set(plans.map(p => p.user_email))];
  for (const email of uniqueUsers) {
    const plan = plans.find(p => p.user_email === email && p.pushover_user_key);
    if (!plan || !pushoverAppToken) continue;

    const res = await fetch(`${url}/rest/v1/commute_savings_log?user_email=eq.${encodeURIComponent(email)}`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const logs = await res.json();
    const totalMinutes = Array.isArray(logs) ? logs.reduce((sum, log) => sum + (log.minutes_saved || 0), 0) : 0;

    await sendPushover(
      pushoverAppToken,
      plan.pushover_user_key,
      '🏆 Your Verified Friday Commute Scorecard',
      `This week, your verified on-time departures saved you ${totalMinutes} mins (~${(totalMinutes / 60).toFixed(1)} hrs) from Bangalore peak crawl.\n\nEnjoy your weekend!`,
      `https://rhljbzhpjhjsbknpiajn.supabase.co`,
      'View Commute Log'
    );
  }
  return { dispatchedWeeklyScorecards: uniqueUsers.length };
}

function formatMinutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
