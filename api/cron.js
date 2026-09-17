// api/cron.js
export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const fetchRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?alerts_enabled=eq.true`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const plans = await fetchRes.json();

  if (!Array.isArray(plans) || !plans.length) {
    return res.status(200).json({ message: 'No registered plans' });
  }

  const now = new Date();
  const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const host = req.headers.host || 'blr-commute.vercel.app';

  const dispatched = [];

  for (const plan of plans) {
    if (plan.day_of_week !== currentDay || plan.is_wfh || !plan.phone || !plan.whatsapp_apikey) continue;

    const [th, tm] = plan.leave_home_time.split(':').map(Number);
    const depMinutes = th * 60 + tm;
    const diff = depMinutes - currentMinutes;

    // 1. MORNING PRE-TRIP ADVICE (20–40 mins before scheduled departure)
    if (diff >= 20 && diff <= 40) {
      const depDisplay = formatMinutesTo12(depMinutes);
      const mapsLink = `https://maps.google.com/?saddr=${plan.origin_lat},${plan.origin_lng}&daddr=${plan.dest_lat},${plan.dest_lng}`;

      const alertMsg = 
`🚨 *BLR COMMUTE ALERT: TIME TO DEPART*

📍 *Route:* ${plan.origin_name} ➔ ${plan.dest_name}
🎯 *Optimal Departure:* ${depDisplay} (±7 mins window)
⏱️ *Estimated Drive Time:* 35 to 48 mins

💡 *Traffic Status:* Bottlenecks forming along the corridor. Leaving past ${formatMinutesTo12(depMinutes + 20)} will add +25 mins crawl time.

🔗 Live Navigation: ${mapsLink}`;

      await sendWhatsApp(plan.phone, alertMsg, plan.whatsapp_apikey);
      dispatched.push({ type: 'pre_trip', user: plan.user_email });
    }

    // 2. POST-TRIP CHECKPOINT FEEDBACK (25 mins after scheduled departure)
    if (diff <= -25 && diff >= -45) {
      const yesLink = `https://${host}/api/feedback?email=${encodeURIComponent(plan.user_email)}&status=on_time&day=${currentDay}&saved=25`;
      const delayedLink = `https://${host}/api/feedback?email=${encodeURIComponent(plan.user_email)}&status=delayed&day=${currentDay}&saved=0`;

      const checkMsg = 
`⏱️ *DAILY COMMUTE CHECKPOINT*

Did you manage to depart around *${formatMinutesTo12(depMinutes)}* today?

1️⃣ *Yes, Left on Schedule* (+25 mins saved):
${yesLink}

2️⃣ *No, Got Delayed:*
${delayedLink}

_Tap your answer above to audit your weekly saved hours._`;

      await sendWhatsApp(plan.phone, checkMsg, plan.whatsapp_apikey);
      dispatched.push({ type: 'feedback_prompt', user: plan.user_email });
    }
  }

  return res.status(200).json({ success: true, count: dispatched.length, dispatched });
}

async function sendWhatsApp(phone, text, apiKey) {
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
    await fetch(url);
  } catch (e) {}
}

function formatMinutesTo12(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}
