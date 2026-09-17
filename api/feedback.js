// api/feedback.js
export default async function handler(req, res) {
  const { email, status, day, saved } = req.query;

  if (!email) return res.status(400).send('Missing commuter identifier');

  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  const minsSaved = status === 'on_time' ? parseInt(saved || '25', 10) : 0;

  // 1. Log Feedback
  await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      user_email: email,
      day_of_week: day || 'Weekday',
      scheduled_departure: 'Audited via Checkpoint',
      feedback_status: status,
      minutes_saved: minsSaved
    })
  });

  // 2. Query Cumulative Savings
  const logRes = await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log?user_email=eq.${encodeURIComponent(email)}`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  const allLogs = await logRes.json();
  const totalMins = Array.isArray(allLogs) ? allLogs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : minsSaved;
  const totalHours = (totalMins / 60).toFixed(1);

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Commute Logged</title>
      <style>
        body{background:#070b09;color:#f9fafb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}
        .card{background:#0f1713;border:1px solid rgba(16,185,129,0.3);padding:32px 24px;border-radius:20px;max-width:380px}
        .num{font-size:42px;font-weight:800;color:#10b981;margin:12px 0 4px}
        h2{margin:0;font-size:18px}
        p{color:#9ca3af;font-size:13px;line-height:1.5}
      </style>
    </head>
    <body>
      <div class="card">
        <div style="font-size:36px;margin-bottom:8px">🎉</div>
        <h2>Feedback Recorded!</h2>
        <div class="num">${totalMins}m</div>
        <p>Total cumulative time saved from Bangalore peak traffic so far (~<b>${totalHours} hours</b> reclaimed).</p>
      </div>
    </body>
    </html>
  `);
}
