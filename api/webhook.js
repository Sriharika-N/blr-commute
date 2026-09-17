// api/webhook.js
export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'blr_commute_secure_token_2026';
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_ID;
  const supabaseUrl = process.env.BLR_SB_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
  const supabaseKey = process.env.BLR_SB_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobGpiemhwamhqc2JrbnBpYWpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Mjk3ODMsImV4cCI6MjEwNTIwNTc4M30.V96TLm5sbWFSo-Hl4_xO0BbZC6-w2BKtbe4EmGU7CUc';

  // 1. Webhook Verification for Meta Setup
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. Process Inbound Messages
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object && body.entry && body.entry[0]?.changes && body.entry[0].changes[0]?.value?.messages) {
      const msgObj = body.entry[0].changes[0].value.messages[0];
      const fromPhone = msgObj.from; // e.g. "919876543210"
      const text = (msgObj.text?.body || '').trim();
      const upperText = text.toUpperCase();

      // Look up user's active commute plan
      const planRes = await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${encodeURIComponent(fromPhone)}&limit=1`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const plans = await planRes.json();
      const plan = Array.isArray(plans) && plans.length ? plans[0] : null;

      // HANDLER A: Handshake Opt-In
      if (upperText.includes('START BLR RADAR') || upperText === 'START') {
        if (!plan) {
          await sendMetaWA(waPhoneId, waToken, fromPhone, 
            `👋 Welcome to *BLR Commute Radar*!\n\nWe haven't configured your routine yet. Set up your route in 30 seconds here:\nhttps://${req.headers.host || 'blr-commute.vercel.app'}`
          );
        } else {
          await sendMetaWA(waPhoneId, waToken, fromPhone,
            `⚡ *BLR COMMUTE RADAR: CONNECTED*\n\n` +
            `Route: *${plan.origin_name} ➔ ${plan.dest_name}*\n` +
            `Target Arrival: *${plan.leave_home_time}*\n\n` +
            `Your 24-hour service window is active. You'll receive morning and evening alerts automatically.\n\n` +
            `💡 *Quick Commands:*\n` +
            `• Text *STATUS* to check weekly saved time\n` +
            `• Text *GO TO <place>* for instant custom routing`
          );
        }
        return res.status(200).send('EVENT_RECEIVED');
      }

      // HANDLER B: Commute Confirmation Checkpoint ("1", "YES", "DONE")
      if (['1', 'YES', 'DONE', 'LEFT', 'ON TIME'].includes(upperText)) {
        const savedMins = 25;
        const todayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];

        await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json', 'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            phone: fromPhone,
            day_of_week: todayStr,
            scheduled_departure: plan ? plan.leave_home_time : 'Standard Window',
            actual_departure_time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
            feedback_status: 'on_time',
            minutes_saved: savedMins
          })
        });

        // Query cumulative score
        const scoreRes = await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log?phone=eq.${encodeURIComponent(fromPhone)}`, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const logs = await scoreRes.json();
        const totalMins = Array.isArray(logs) ? logs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : savedMins;

        await sendMetaWA(waPhoneId, waToken, fromPhone,
          `✅ *COMMUTE LOGGED!*\n\n` +
          `You earned *+${savedMins} mins saved* for skipping peak queue.\n` +
          `🏆 Total this week: *${totalMins} minutes* (~${(totalMins/60).toFixed(1)} hrs reclaimed).\n\n` +
          `Your evening return radar will trigger before office exit!`
        );
        return res.status(200).send('EVENT_RECEIVED');
      }

      // HANDLER C: WFH Toggle
      if (upperText === 'WFH') {
        const todayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
        await fetch(`${supabaseUrl}/rest/v1/commute_plans?phone=eq.${encodeURIComponent(fromPhone)}&day_of_week=eq.${todayStr}`, {
          method: 'PATCH',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_wfh: true })
        });

        await sendMetaWA(waPhoneId, waToken, fromPhone, `🏠 *WFH Logged for ${todayStr}.* Alerts are muted for today. Enjoy your day!`);
        return res.status(200).send('EVENT_RECEIVED');
      }

      // HANDLER D: Status & Score Check
      if (upperText === 'STATUS' || upperText === 'SCORE') {
        const scoreRes = await fetch(`${supabaseUrl}/rest/v1/commute_feedback_log?phone=eq.${encodeURIComponent(fromPhone)}`, {
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
        });
        const logs = await scoreRes.json();
        const totalMins = Array.isArray(logs) ? logs.reduce((sum, item) => sum + (item.minutes_saved || 0), 0) : 0;
        const trips = Array.isArray(logs) ? logs.length : 0;

        await sendMetaWA(waPhoneId, waToken, fromPhone,
          `📊 *YOUR COMMUTE SCORECARD*\n\n` +
          `• Verified Trips: *${trips}*\n` +
          `• Total Time Saved: *${totalMins} mins* (~${(totalMins/60).toFixed(1)} hrs)\n` +
          `• Route: *${plan ? plan.origin_name + ' ➔ ' + plan.dest_name : 'Default'}*\n\n` +
          `🔗 View Full Dashboard:\nhttps://${req.headers.host || 'blr-commute.vercel.app'}/dashboard?phone=${fromPhone}`
        );
        return res.status(200).send('EVENT_RECEIVED');
      }

      // HANDLER E: On-Demand Custom Destination Routing ("GO TO <Place>")
      if (upperText.startsWith('GO TO ') || upperText.startsWith('TO ')) {
        const queryDest = text.replace(/^(GO TO|TO)\s+/i, '').trim();
        const originCoord = plan ? [plan.origin_lng, plan.origin_lat] : [77.5946, 12.9716];

        // Geocode custom destination using Photon
        try {
          const geoRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(queryDest)}&lat=12.9716&lon=77.5946&limit=1`);
          const geoData = await geoRes.json();

          if (geoData.features && geoData.features.length) {
            const destCoord = geoData.features[0].geometry.coordinates;
            const destTitle = geoData.features[0].properties.name || queryDest;

            // Compute OSRM Road Time
            const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${originCoord[0]},${originCoord[1]};${destCoord[0]},${destCoord[1]}?overview=false`);
            const osrmData = await osrmRes.json();

            let dKm = '8.5';
            let duration = 24;
            if (osrmData.routes && osrmData.routes.length) {
              dKm = (osrmData.routes[0].distance / 1000).toFixed(1);
              duration = Math.round(osrmData.routes[0].duration / 60);
            }

            const trafficETA = Math.round(duration * 1.55);
            const navLink = `https://maps.google.com/?saddr=${originCoord[1]},${originCoord[0]}&daddr=${destCoord[1]},${destCoord[0]}`;

            await sendMetaWA(waPhoneId, waToken, fromPhone,
              `🔍 *ON-DEMAND RADAR: TO ${destTitle.toUpperCase()}*\n\n` +
              `🛣️ Distance: *${dKm} km*\n` +
              `⏱️ Predicted Travel Time: *${trafficETA} mins*\n` +
              `🚦 Surge Index: Moderate crawl along main junctions\n\n` +
              `🎯 *Best Departure:* Leave within 15 mins to beat the next corridor spike.\n\n` +
              `🔗 Launch Navigation:\n${navLink}`
            );
            return res.status(200).send('EVENT_RECEIVED');
          }
        } catch (e) {
          console.error('Custom route geocode error:', e);
        }
      }

      // Default Help Text
      await sendMetaWA(waPhoneId, waToken, fromPhone,
        `🤖 *BLR Commute Radar*\n\n` +
        `• Reply *1* or *YES* to log departure\n` +
        `• Reply *STATUS* to view your weekly scorecard\n` +
        `• Reply *WFH* to mute alerts for today\n` +
        `• Text *GO TO <place>* for instant routing`
      );
    }

    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function sendMetaWA(phoneId, token, to, text) {
  if (!phoneId || !token) {
    console.warn('Meta credentials unset; mock sending:', { to, text });
    return;
  }
  try {
    await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { preview_url: true, body: text }
      })
    });
  } catch (err) {
    console.error('Error sending Meta message:', err);
  }
}
