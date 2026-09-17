// api/refresh-traffic.js
export default async function handler(req, res) {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const r = await fetch(`${supabaseUrl}/rest/v1/commute_plans?user_email=eq.${encodeURIComponent(email)}&limit=1`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const rows = await r.json();
  if (!rows || !rows.length) return res.status(404).json({ error: 'Plan not found' });

  const plan = rows[0];
  const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=precipitation,temperature_2m&timezone=Asia/Kolkata');
  const wData = await wRes.json();
  const rain = wData.current?.precipitation || 0;

  const [h, m] = plan.leave_home_time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const depStr = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;

  return res.status(200).json({
    success: true,
    todayDeparture: depStr,
    arrivalRange: rain > 2 ? '45 - 65 mins (Rain Delay)' : '35 - 48 mins',
    weather: rain > 2 ? `Rain Active (${rain}mm/hr)` : 'Clear & Dry'
  });
}
