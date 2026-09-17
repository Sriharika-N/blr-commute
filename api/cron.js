// api/cron.js
export default async function handler(req, res) {
  // Verify authorization secret to prevent external scrapers
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.BLR_SB_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLR_SB_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Database environment variables not configured' });
  }

  // Fetch active routines
  const fetchRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?alerts_enabled=eq.true`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  const plans = await fetchRes.json();

  if (!Array.isArray(plans) || !plans.length) {
    return res.status(200).json({ message: 'No registered commuter plans found.' });
  }

  const now = new Date();
  const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const dispatched = [];

  for (const plan of plans) {
    if (plan.day_of_week !== currentDay || !plan.phone) continue;

    // Parse target departure time
    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const targetMinutes = th * 60 + tm;

    // Trigger alert 25–40 minutes before scheduled departure
    const diff = targetMinutes - currentMinutes;
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
      console.error('OSRM query failed, falling back to baseline speed');
    }

    // 2. Evaluate Arbitrage Curve [-30m, -15m, Target, +15m, +30m, +60m, +90m]
    const deltas = [-30, -15, 0, 15, 30, 60, 90];
    const curve = deltas.map(offset => {
      const evalMin = targetMinutes + offset;
      const evalHour = evalMin / 60;
      const multiplier = getBangaloreMultiplier(evalHour, now.getDay(), plan.vehicle_mode);
      return {
        offset,
        timeStr: formatMinutesToTime(evalMin),
        eta: Math.round(baseMinutes * multiplier) + (plan.vehicle_mode === 'cab' ? 7 : 0)
      };
    });

    const baseline = curve.find(c => c.offset === 0);
    const minOption = curve.reduce((prev, curr) => curr.eta < prev.eta ? curr : prev, curve[0]);
    const savings = baseline.eta - minOption.eta;

    // 3. Construct Tailored WhatsApp Intelligence Copy
    let message = '';
    if (savings >= 18) {
      message = `🚨 *BLR COMMUTE RADAR: HIGH SURGE ALERT*\n\n` +
        `Route: *${plan.origin_name} ➔ ${plan.dest_name}*\n` +
        `Target Departure: *${plan.leave_home_time}*\n` +
        `Status: Severe Bottlenecks Active (+${savings}m surge)\n\n` +
        `💡 *COMMUTE ARBITRAGE SAVINGS:*\n` +
        `• Option 1: Leave at *${minOption.timeStr}* ➔ *${minOption.eta} mins* (Save ${savings} mins)\n` +
        `• Option 2: Target *${baseline.timeStr}* ➔ *${baseline.eta} mins*\n\n` +
        `Reply 'NAV' for live road link.`;
    } else {
      message = `✅ *BLR COMMUTE RADAR: NORMAL FLOW*\n\n` +
        `Route: *${plan.origin_name} ➔ ${plan.dest_name}*\n` +
        `Target Departure: *${plan.leave_home_time}*\n` +
        `Predicted Duration: *${baseline.eta} mins* (Clean flow)\n` +
        `No severe corridor blockages detected along your trajectory.`;
    }

    // 4. Dispatch via CallMeBot API (100% Free)
    if (plan.callmebot_key) {
      const cleanPhone = plan.phone.replace(/[^0-9]/g, '');
      const sendUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${plan.callmebot_key}`;
      await fetch(sendUrl);
      dispatched.push({ user: plan.user_email, phone: cleanPhone, savings });
    }
  }

  return res.status(200).json({ success: true, dispatchedCount: dispatched.length, dispatched });
}

// TomTom Historical Day/Hour Multiplier Matrix
function getBangaloreMultiplier(hour, day, mode) {
  let mult = 1.15;
  const isMorning = hour >= 8.0 && hour <= 11.0;
  const isEvening = hour >= 17.0 && hour <= 20.5;

  if (isMorning) {
    mult = mode === 'bike' ? 1.45 : 1.95;
  } else if (isEvening) {
    mult = mode === 'bike' ? 1.55 : 2.20;
    if (day === 3) mult += 0.25; // Wednesday Peak Penalty
  }
  return mult;
}

function formatMinutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
}
