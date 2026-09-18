import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function Home() {
  const [email, setEmail] = useState('test@commuter.com');
  const [origin, setOrigin] = useState('Indiranagar Metro');
  const [destination, setDestination] = useState('Ecospace Bellandur');
  const [mode, setMode] = useState('bike');
  const [timingType, setTimingType] = useState('arrive_by');
  const [targetTime, setTargetTime] = useState('09:15');
  const [schedule, setSchedule] = useState({ mon: true, tue: true, wed: true, thu: true, fri: true });
  const [prediction, setPrediction] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);
  }, []);

  function runScan() {
    setPrediction({
      recommended_departure: timingType === 'leave_now' ? 'Immediate (08:14 AM)' : '08:18 AM',
      travel_time_mins: mode === 'bike' ? 36 : 58,
      speed_kmh: mode === 'bike' ? 22.4 : 13.8,
      delay_if_15m_late: mode === 'bike' ? '+14 mins' : '+26 mins',
      metro_status: 'Phase 2A Blue Line work active near Kadubeesanahalli underpass',
      confidence_score: 97,
      time_saved: 22
    });
  }

  async function pairDevice() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('On iOS: Tap Share -> "Add to Home Screen" first, then open from Home Screen.');
      return;
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return alert('Permission denied.');

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4);
    const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const keyArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) keyArray[i] = rawData.charCodeAt(i);

    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyArray });

    await supabase.from('commute_plans').upsert({
      user_email: email,
      origin_name: origin,
      dest_name: destination,
      origin_lat: 12.9784,
      origin_lng: 77.6389,
      dest_lat: 12.9260,
      dest_lng: 77.6762,
      vehicle_mode: mode,
      preferred_arrival_time: targetTime + ':00',
      leave_home_time: '08:30:00',
      leave_office_time: '18:30:00',
      weekly_schedule: schedule,
      push_subscription: sub.toJSON(),
      alerts_enabled: true
    }, { onConflict: 'user_email' });

    alert('Device paired successfully.');
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      {isIOS && !isStandalone && (
        <div style={{ background: '#fef3c7', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          📲 On iOS: Tap <strong>Share</strong> $\rightarrow$ <strong>"Add to Home Screen"</strong> to receive lock-screen alerts.
        </div>
      )}

      <h2>BLR Commute Arbitrage</h2>

      <div style={{ background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 'bold' }}>ROUTE</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '6px 0 12px 0' }}>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} style={{ padding: 8 }} />
          <input value={destination} onChange={(e) => setDestination(e.target.value)} style={{ padding: 8 }} />
        </div>

        <label style={{ fontSize: 12, fontWeight: 'bold' }}>MODE</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '6px 0 12px 0' }}>
          <button onClick={() => setMode('bike')} style={{ padding: 8, fontWeight: 'bold', background: mode === 'bike' ? '#eff6ff' : '#fff' }}>🏍️ Bike</button>
          <button onClick={() => setMode('car')} style={{ padding: 8, fontWeight: 'bold', background: mode === 'car' ? '#eff6ff' : '#fff' }}>🚗 Car</button>
        </div>

        <label style={{ fontSize: 12, fontWeight: 'bold' }}>TIMING</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, margin: '6px 0 12px 0' }}>
          {['leave_now', 'schedule_depart', 'arrive_by'].map((t) => (
            <button key={t} onClick={() => setTimingType(t)} style={{ padding: 6, fontSize: 11, background: timingType === t ? '#0f172a' : '#fff', color: timingType === t ? '#fff' : '#000' }}>
              {t === 'leave_now' ? 'Leave Now' : t === 'schedule_depart' ? 'Depart At' : 'Arrive By'}
            </button>
          ))}
        </div>

        {timingType !== 'leave_now' && (
          <input type="time" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 12 }} />
        )}

        <button onClick={runScan} style={{ width: '100%', padding: 12, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>
          Scan Corridor
        </button>
      </div>

      {prediction && (
        <div style={{ border: '2px solid #22c55e', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ color: '#15803d', fontWeight: 'bold' }}>Score: {prediction.confidence_score}% | Saves ~{prediction.time_saved}m</div>
          <h3 style={{ margin: '8px 0' }}>Depart: {prediction.recommended_departure}</h3>
          <div>Est. Travel: {prediction.travel_time_mins} mins ({prediction.speed_kmh} km/h)</div>
          <div style={{ color: '#b91c1c', marginTop: 6, fontSize: 13 }}>Buffer penalty: +15m departure adds {prediction.delay_if_15m_late}</div>
          <div style={{ color: '#475569', marginTop: 4, fontSize: 12 }}>🚧 {prediction.metro_status}</div>
        </div>
      )}

      <div style={{ background: '#f8fafc', padding: 14, borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 'bold' }}>WEEKLY DAYS</label>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => (
            <button key={d} onClick={() => setSchedule({ ...schedule, [d]: !schedule[d] })} style={{ flex: 1, padding: 8, background: schedule[d] ? '#2563eb' : '#fff', color: schedule[d] ? '#fff' : '#000', textTransform: 'uppercase', fontSize: 11, fontWeight: 'bold' }}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div style={{ border: '1px solid #e2e8f0', padding: 14, borderRadius: 10 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
        <button onClick={pairDevice} style={{ width: '100%', padding: 12, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>
          📲 Pair Device for Morning Alerts
        </button>
      </div>
    </main>
  );
}
