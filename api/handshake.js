// api/handshake.js
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, phone, fromName, toName, fc, tc, mode, weekSchedule } = req.body || {};

    if (!email || !phone || !fc || !tc) {
      return res.status(400).json({ error: 'Missing required configuration fields' });
    }

    const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
    const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');

    // 1. Calculate OSRM Clean Drive Time
    const profile = mode === 'bike' ? 'bike' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${fc[0]},${fc[1]};${tc[0]},${tc[1]}?overview=false`;
    
    let cleanMinutes = 25;
    try {
      const oRes = await fetch(osrmUrl);
      const oData = await oRes.json();
      if (oData.routes && oData.routes.length) {
        cleanMinutes = Math.round(oData.routes[0].duration / 60);
      }
    } catch (e) {}

    // 2. Prepare Mon-Fri Schedule Records
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const safeSched = weekSchedule || {};

    const records = days.map((day, idx) => {
      const conf = safeSched[day] || { arrive: '09:30', return: '18:30', isWFH: false };
      const [ah, am] = (conf.arrive || '09:30').split(':').map(Number);
      const arrMins = ah * 60 + am;

      // Wednesday historical worst surge (+25m buffer), others standard
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

    // 3. Persist to Supabase
    await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${cleanPhone}`, {
      method: 'DELETE',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });

    await fetch(`${supabaseUrl}/rest/v1/commute_plans`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify(records)
    });

    return res.status(200).json({
      success: true,
      businessPhone: process.env.META_PHONE_NUMBER || '15551390497', // Your Meta test business phone
      message: 'Plan saved successfully'
    });

  } catch (err) {
    console.error('Handshake failure:', err);
    return res.status(500).json({ error: err.message });
  }
}
