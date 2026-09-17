// api/cron.js
export default async function handler(req, res) {
  // Authorization check
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.BLR_SB_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLR_SB_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials missing' });
  }

  // Fetch live weather across Bengaluru (Open-Meteo free endpoint)
  const weather = await getBengaluruWeather();

  // Fetch active commuter routines
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

  // Check if Friday Evening Digest should trigger (between 5:00 PM and 5:30 PM IST)
  if (currentDay === 'Friday' && currentMinutes >= 1020 && currentMinutes <= 1050) {
    const digestResult = await processFridayDigest(plans, supabaseUrl, supabaseKey);
    return res.status(200).json({ mode: 'friday_digest', ...digestResult });
  }

  const dispatched = [];

  for (const plan of plans) {
    if (plan.day_of_week !== currentDay || !plan.phone || !plan.callmebot_key) continue;

    // Parse target morning departure
    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const targetMinutes = th * 60 + tm;
    const diff = targetMinutes - currentMinutes;

    // Check if within the 20 to 45 min alert window
    if (diff < 20 || diff > 45) continue;

    // 1. Fetch free-flow road duration from OSRM
    const profile = plan.vehicle_mode === 'bike' ? 'bike' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${plan.origin_lng},${plan.origin_lat};${plan.dest_lng},${plan.dest_lat}?overview=false`;
    
    let baseMinutes = 25;
    try {
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();
      if (osrmData.routes && osrmData.routes.length) {
        baseMinutes = Math.round(osrmData.routes[0].duration / 60);
      }
    } catch (e) {
      console.error('OSRM query failed, falling back to default baseline');
    }

    // 2. Multi-window Arbitrage Curve with Weather Multiplier
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

    // Log savings to database for the Friday digest
    if (savings > 0) {
      await logSavings(supabaseUrl, supabaseKey, plan.user_email, currentDay, savings);
    }

    // 3. Build WhatsApp Alert
    let message = '';
    const rainWarning = weather.isRaining 
      ? `🌧️ *RAIN IMPACT:* ${weather.rain}mm/hr active. High waterlogging risk along ORR/Hebbal (+${weather.delayAdd}m delay).\n\n` 
      : '';

    if (savings >= 18) {
      message = `🚨 *BLR COMMUTE RADAR: HIGH SURGE ALERT*\n\n` +
        rainWarning +
        `Route: *${plan.origin_name} ➔ ${plan.dest_name}*\n` +
        `Target Departure: *${plan.leave_home_time}*\n` +
        `Bottlenecks Active: Peak queue delay (+${savings}m)\n\n` +
        `💡 *COMMUTE ARBITRAGE SAVINGS:*\n` +
        `• Option 1: Leave at *${minOption.timeStr}* ➔ *${minOption.eta} mins* (Save ${savings} mins)\n` +
        `• Option 2: Target *${baseline.timeStr}* ➔ *${baseline.eta} mins*\n\n` +
        `Reply 'NAV' for live road link.`;
    } else {
      message = `✅ *BLR COMMUTE RADAR: OPTIMAL FLOW*\n\n` +
        rainWarning +
        `Route: *${plan.origin_name} ➔ ${plan.dest_name}*\n` +
        `Target Departure: *${plan.leave_home_time}*\n` +
        `Predicted Duration: *${baseline.eta} mins*\n` +
        `Flow is steady. Safe to depart on schedule.`;
    }

    // 4. Send via CallMeBot
    const cleanPhone = plan.phone.replace(/[^0-9]/g, '');
    const sendUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${plan.callmebot_key}`;
    await fetch(sendUrl);

    dispatched.push({ user: plan.user_email, savings, isRaining: weather.isRaining });
  }

  return res.status(200).json({ success: true, dispatchedCount: dispatched.length, dispatched });
}

// Live Weather Query (Open-Meteo Free API)
async function getBengaluruWeather() {
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=precipitation,temperature_2m&timezone=Asia/Kolkata');
    const data = await res.json();
    const rain = data.current?.precipitation || 0;
    return {
      rain,
      isRaining: rain > 0.5,
      delayAdd: rain > 5 ? 25 : (rain > 1 ? 15 : 0)
    };
  } catch (err) {
    return { rain: 0, isRaining: false, delayAdd: 0 };
  }
}

// Bangalore Traffic Surge Multiplier + Rain Factor
function getBangaloreMultiplier(hour, day, mode, rain = 0) {
  let mult = 1.15;
  const isMorning = hour >= 8.0 && hour <= 11.0;
  const isEvening = hour >= 17.0 && hour <= 20.5;

  if (isMorning) {
    mult = mode === 'bike' ? 1.45 : 1.95;
  } else if (isEvening) {
    mult = mode === 'bike' ? 1.55 : 2.20;
    if (day === 3) mult += 0.25; // Wednesday worst day penalty
  }

  // Rain multiplier: Bangalore drainage bottlenecks scale traffic heavily
  if (rain > 5) mult += 0.35;
  else if (rain > 1) mult += 0.20;

  return mult;
}

// Log Savings to Supabase
async function logSavings(url, key, email, day, minutes) {
  try {
    await fetch(`${url}/rest/v1/commute_savings_log`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_email: email,
        day_of_week: day,
        minutes_saved: minutes
      })
    });
  } catch (e) {
    console.error('Failed to log savings:', e);
  }
}

// Friday 5:00 PM Scorecard Generator
async function processFridayDigest(plans, url, key) {
  const dispatched = [];
  const uniqueUsers = [...new Set(plans.map(p => p.user_email))];

  for (const email of uniqueUsers) {
    const userPlan = plans.find(p => p.user_email === email && p.phone && p.callmebot_key);
    if (!userPlan) continue;

    // Fetch this week's savings
    const res = await fetch(`${url}/rest/v1/commute_savings_log?user_email=eq.${encodeURIComponent(email)}`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const logs = await res.json();

    const totalMinutes = Array.isArray(logs) ? logs.reduce((sum, log) => sum + (log.minutes_saved || 0), 0) : 0;
    const hours = (totalMinutes / 60).toFixed(1);

    const message = `🏆 *YOUR WEEKLY COMMUTE SCORECARD*\n\n` +
      `Hey! By timing your departures around peak traffic surges this week, you reclaimed:\n\n` +
      `⏱️ *${totalMinutes} Minutes* (~${hours} Hours of life saved)\n\n` +
      `That's ${totalMinutes > 60 ? 'more than a full movie' : 'valuable evening rest'} not lost to ORR and Silk Board.\n` +
      `Rest up this weekend! Your radar resumes Monday morning.`;

    const cleanPhone = userPlan.phone.replace(/[^0-9]/g, '');
    const sendUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${userPlan.callmebot_key}`;
    await fetch(sendUrl);

    dispatched.push({ email, totalMinutes });
  }

  return { dispatchedWeeklyScorecards: dispatched.length, dispatched };
}

function formatMinutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
}
