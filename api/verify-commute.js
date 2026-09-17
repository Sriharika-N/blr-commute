// api/verify-commute.js
export default async function handler(req, res) {
  const { email, status, day, saved } = req.query;

  if (!email) {
    return res.status(400).send('Missing commuter identifier');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const minsSaved = status === 'confirmed_on_time' ? parseInt(saved || '25', 10) : 0;
  const nowStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

  try {
    await fetch(`${supabaseUrl}/rest/v1/commute_savings_log`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_email: email,
        day_of_week: day || 'Weekday',
        planned_departure: 'Logged via Checkpoint',
        actual_departure_status: status || 'confirmed_on_time',
        actual_departure_time: nowStr,
        minutes_saved: minsSaved
      })
    });
  } catch (err) {
    console.error('Failed to log verified commute:', err);
  }

  // Render a clean acknowledgment page
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Commute Verified</title>
      <style>
        body{background:#070b09;color:#f9fafb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center}
        .card{background:#0f1713;border:1px solid rgba(16,185,129,0.3);padding:30px;border-radius:16px;max-width:380px}
        .ico{font-size:40px;margin-bottom:12px}
        h2{margin:0 0 8px;color:#10b981}
        p{color:#9ca3af;font-size:14px;line-height:1.5}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="ico">${status === 'confirmed_on_time' ? '🎉' : '⏱️'}</div>
        <h2>${status === 'confirmed_on_time' ? 'Departure Confirmed!' : 'Logged'}</h2>
        <p>${status === 'confirmed_on_time' ? `Logged <b>+${minsSaved} minutes saved</b> for your Friday Scorecard.` : 'Departure time noted. We will adjust your return window accordingly.'}</p>
      </div>
    </body>
    </html>
  `);
}
