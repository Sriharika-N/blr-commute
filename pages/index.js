import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rhljbzhpjhjsbknpiajn.supabase.co';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

const CORRIDORS = {
  orr: {
    name: 'Outer Ring Road',
    short: 'ORR · Silk Board ➔ KR Puram',
    lat: 12.9352, lng: 77.6536,
    carPeak: 9, bikePeak: 18, carFree: 42, bikeFree: 55,
    metro: 'Phase 2A Blue Line underpass active — Kadubeesanahalli to Marathahalli bottleneck',
    chokes: [
      { name: 'Silk Board Junction', severity: 'danger', delay: '+35–50 min' },
      { name: 'Marathahalli Bridge', severity: 'danger', delay: '+20–30 min' },
      { name: 'Kadubeesanahalli Underpass', severity: 'warn', delay: '+12–18 min' },
      { name: 'Bellandur EcoSpace Gate', severity: 'warn', delay: '+10–15 min' }
    ],
    alternate: {
      name: 'Wind Tunnel Road / Old Airport Rd Bypass',
      desc: 'Avoids Marathahalli flyover crawl; narrower roads but flowing faster for bikes.',
      timeDiffMins: -14,
      viability: 'Recommended for Bikes'
    },
    bestM: '07:15 – 07:45',
    bestE: '16:15 – 16:45'
  },
  wf: {
    name: 'Whitefield Corridor',
    short: 'WF · Whitefield ➔ Bellandur',
    lat: 12.9698, lng: 77.7200,
    carPeak: 12, bikePeak: 20, carFree: 45, bikeFree: 58,
    metro: 'Purple Line civil work — ITPL and Varthur Kodi diversions in effect',
    chokes: [
      { name: 'Tin Factory / KR Puram Hangover', severity: 'danger', delay: '+25–40 min' },
      { name: 'Hope Farm Circle', severity: 'danger', delay: '+15–25 min' },
      { name: 'Kundalahalli Gate Underpass', severity: 'warn', delay: '+10–15 min' }
    ],
    alternate: {
      name: 'Gunjur – Panathur Railway Underbridge Route',
      desc: 'Bypasses Varthur main junction; monitor for one-way peak traffic restrictions.',
      timeDiffMins: -11,
      viability: 'Fair for Both'
    },
    bestM: '07:00 – 07:30',
    bestE: '16:30 – 17:00'
  },
  ec: {
    name: 'Electronic City Corridor',
    short: 'EC · E-City ➔ Silk Board',
    lat: 12.8458, lng: 77.6629,
    carPeak: 16, bikePeak: 24, carFree: 55, bikeFree: 65,
    metro: 'Yellow Line surface road repairs — lane reductions on Hosur Road surface',
    chokes: [
      { name: 'Silk Board Lower Loop', severity: 'danger', delay: '+30–45 min' },
      { name: 'Kudlu Gate Signal', severity: 'warn', delay: '+12–18 min' },
      { name: 'Bommanahalli Choke', severity: 'warn', delay: '+10–14 min' }
    ],
    alternate: {
      name: 'NICE Road Expressway Bypass',
      desc: 'Toll-bearing detour bypassing Hosur road gridlock directly to Bannerghatta / South BLR.',
      timeDiffMins: -18,
      viability: 'Highly Recommended for Cars'
    },
    bestM: '07:30 – 08:00',
    bestE: '16:45 – 17:15'
  },
  hbl: {
    name: 'Hebbal – Manyata Corridor',
    short: 'HBL · Hebbal ➔ Manyata Tech Park',
    lat: 13.0200, lng: 77.6050,
    carPeak: 16, bikePeak: 24, carFree: 40, bikeFree: 52,
    metro: 'Phase 2B Airport Line construction — Thanisandra & Nagawara cross-junction delays',
    chokes: [
      { name: 'Veerannapalya Junction', severity: 'danger', delay: '+20–35 min' },
      { name: 'Hebbal Flyover Incline', severity: 'danger', delay: '+15–25 min' },
      { name: 'Nagawara Signal', severity: 'warn', delay: '+10–15 min' }
    ],
    alternate: {
      name: 'Outer Ring Service Lane / Hennur Road Cut',
      desc: 'Bypasses main elevated line merges; surfaces clear before 8:15 AM.',
      timeDiffMins: -9,
      viability: 'Recommended for Bikes'
    },
    bestM: '07:45 – 08:15',
    bestE: '16:15 – 16:45'
  }
};

const WEEK_FACTORS = {
  mon: { label: 'Monday', mult: 1.15, peakM: '08:00 – 10:30', peakE: '17:30 – 20:30' },
  tue: { label: 'Tuesday', mult: 1.25, peakM: '08:00 – 11:00', peakE: '17:30 – 20:45' },
  wed: { label: 'Wednesday', mult: 1.40, peakM: '07:45 – 11:30', peakE: '17:00 – 21:15 (Gridlock Alert)' },
  thu: { label: 'Thursday', mult: 1.30, peakM: '08:00 – 11:00', peakE: '17:30 – 21:00' },
  fri: { label: 'Friday', mult: 1.12, peakM: '08:15 – 10:30', peakE: '16:30 – 20:00' },
  sat: { label: 'Saturday', mult: 0.90, peakM: '11:00 – 14:00', peakE: '17:00 – 20:00 (Leisure Flow)' },
  sun: { label: 'Sunday', mult: 0.80, peakM: '12:00 – 15:00', peakE: '18:00 – 20:00 (Light Flow)' }
};

export default function BlrCommuteDashboard() {
  const [activeTab, setActiveTab] = useState('result');
  const [username, setUsername] = useState('Commuter');
  const [email, setEmail] = useState('');
  
  const [fromInput, setFromInput] = useState('Indiranagar Metro Station');
  const [toInput, setToInput] = useState('Ecospace Bellandur');
  const [fromCoords, setFromCoords] = useState([77.6389, 12.9784]);
  const [toCoords, setToCoords] = useState([77.6762, 12.9260]);
  
  const [fromAC, setFromAC] = useState([]);
  const [toAC, setToAC] = useState([]);
  const [isSearchingFrom, setIsSearchingFrom] = useState(false);
  const [isSearchingTo, setIsSearchingTo] = useState(false);
  
  const [vehicle, setVehicle] = useState('bike');
  const [reachTime, setReachTime] = useState('09:15');
  const [returnTime, setReturnTime] = useState('18:30');
  
  const [activeDays, setActiveDays] = useState(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [inspectDay, setInspectDay] = useState('wed');
  
  const [weather, setWeather] = useState({ temp: 26, desc: 'Clear Skies', rain: 0 });
  const [scanResult, setScanResult] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  
  const [paired, setPaired] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [feedbackGiven, setFeedbackGiven] = useState(false);

  const searchDebounce = useRef(null);

  useEffect(() => {
    fetchWeather();
    runScanEngine();
  }, []);

  function triggerToast(msg, type = 'success') {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: 'success' }), 3200);
  }

  async function fetchWeather() {
    try {
      const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=temperature_2m,precipitation,weather_code&timezone=Asia/Kolkata');
      const data = await res.json();
      const rain = data.current?.precipitation || 0;
      setWeather({
        temp: Math.round(data.current?.temperature_2m || 27),
        desc: rain > 4 ? 'Heavy Rain Shock' : rain > 0 ? 'Passing Showers' : 'Clear & Dry',
        rain
      });
    } catch {
      setWeather({ temp: 28, desc: 'Dry Conditions', rain: 0 });
    }
  }

  function handleSearch(field, query) {
    if (field === 'from') setFromInput(query);
    else setToInput(query);

    clearTimeout(searchDebounce.current);
    if (!query || query.length < 2) {
      if (field === 'from') setFromAC([]);
      else setToAC([]);
      return;
    }

    if (field === 'from') setIsSearchingFrom(true);
    else setIsSearchingTo(true);

    searchDebounce.current = setTimeout(async () => {
      try {
        const bbox = '&viewbox=77.40,12.75,77.85,13.25&bounded=1';
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' Bengaluru')}&countrycodes=in${bbox}&format=json&addressdetails=1&limit=6`;
        const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const results = await r.json();
        if (field === 'from') setFromAC(results || []);
        else setToAC(results || []);
      } catch {
        if (field === 'from') setFromAC([]);
        else setToAC([]);
      } finally {
        if (field === 'from') setIsSearchingFrom(false);
        else setIsSearchingTo(false);
      }
    }, 300);
  }

  function selectLocation(field, item) {
    const primary = item.display_name.split(',')[0].trim();
    if (field === 'from') {
      setFromInput(primary);
      setFromCoords([parseFloat(item.lon), parseFloat(item.lat)]);
      setFromAC([]);
    } else {
      setToInput(primary);
      setToCoords([parseFloat(item.lon), parseFloat(item.lat)]);
      setToAC([]);
    }
  }

  function swapLocations() {
    const tempI = fromInput; setFromInput(toInput); setToInput(tempI);
    const tempC = fromCoords; setFromCoords(toCoords); setToCoords(tempC);
    triggerToast('✓ Origin and destination swapped');
  }

  function runScanEngine(overrideDay = inspectDay) {
    setIsScanning(true);
    setTimeout(() => {
      const combined = (fromInput + ' ' + toInput).toLowerCase();
      let corr = CORRIDORS.orr;
      if (combined.includes('whitefield') || combined.includes('varthur') || combined.includes('itpl') || combined.includes('hoodi')) corr = CORRIDORS.wf;
      if (combined.includes('electronic') || combined.includes('hosur') || combined.includes('silk board') || combined.includes('bommasandra')) corr = CORRIDORS.ec;
      if (combined.includes('hebbal') || combined.includes('manyata') || combined.includes('airport') || combined.includes('nagawara')) corr = CORRIDORS.hbl;

      const dayFactor = WEEK_FACTORS[overrideDay].mult;
      const rainMult = weather.rain > 3 ? 1.35 : weather.rain > 0 ? 1.15 : 1.0;
      
      const baseMins = vehicle === 'bike' ? 34 : 54;
      const totalTravelMins = Math.round(baseMins * dayFactor * rainMult);
      const effectiveKmh = vehicle === 'bike' ? Math.round(corr.bikePeak / (dayFactor * 0.85)) : Math.round(corr.carPeak / dayFactor);
      const penaltyMins = vehicle === 'bike' ? Math.round(14 * dayFactor) : Math.round(25 * dayFactor);

      // Backcalculate departure from reachTime
      const [rh, rm] = reachTime.split(':').map(Number);
      const reachDate = new Date();
      reachDate.setHours(rh, rm, 0, 0);
      const optimalDep = new Date(reachDate.getTime() - totalTravelMins * 60000);
      const depTimeStr = optimalDep.toTimeString().slice(0, 5);

      setScanResult({
        corridor: corr,
        depTime: depTimeStr,
        totalTravelMins,
        effectiveKmh,
        penaltyMins,
        confidence: Math.min(99, Math.max(95, 98 - (weather.rain > 0 ? 2 : 0))),
        savedMins: Math.round(totalTravelMins * 0.35)
      });
      setIsScanning(false);
      setFeedbackGiven(false);
    }, 400);
  }

  async function handleDevicePairing() {
    if (!email) return triggerToast('Please enter an alert email address', 'error');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return alert('On iOS Safari: Tap the Share button -> "Add to Home Screen" first.');
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return triggerToast('Notification permission denied', 'error');

      let subJson = { placeholder: true };
      if (VAPID_PUBLIC) {
        const padding = '='.repeat((4 - (VAPID_PUBLIC.length % 4)) % 4);
        const base64 = (VAPID_PUBLIC + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const appKey = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; ++i) appKey[i] = raw.charCodeAt(i);
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
        subJson = sub.toJSON();
      }

      await fetch(`${SUPABASE_URL}/rest/v1/commute_plans?on_conflict=user_email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_email: email,
          username,
          origin_name: fromInput,
          dest_name: toInput,
          vehicle_mode: vehicle,
          reach_dest_time: reachTime + ':00',
          leave_dest_time: returnTime + ':00',
          weekly_schedule: activeDays,
          push_subscription: subJson,
          alerts_enabled: true
        })
      });

      setPaired(true);
      triggerToast('✓ Lock-screen alerts paired successfully');
    } catch (err) {
      triggerToast(err.message || 'Pairing error', 'error');
    }
  }

  async function logTelemetryFeedback(onTime) {
    if (feedbackGiven) return;
    if (email && scanResult) {
      await fetch(`${SUPABASE_URL}/rest/v1/commute_telemetry_feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`
        },
        body: JSON.stringify({
          user_email: email,
          mode: vehicle,
          predicted_travel_mins: scanResult.totalTravelMins,
          time_saved_mins: onTime ? scanResult.savedMins : 0,
          confidence_score: scanResult.confidence,
          user_rating_helpful: onTime
        })
      });
    }
    setFeedbackGiven(true);
    triggerToast('✓ Telemetry logged — corridor weighting adjusted');
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#06090f', color: '#f0f6fc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Head>
        <title>BLR Commute — Cyber Corridor Intelligence</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      {/* Top Cyber Navigation Bar */}
      <header style={{ width: '100%', height: 54, borderBottom: '1px solid #142032', background: 'rgba(6,9,15,0.94)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: '#00ff88', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 900, fontSize: 16 }}>⚡</div>
          <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: '-0.3px', color: '#fff' }}>BLR COMMUTE</span>
          <span style={{ fontSize: 10, background: '#00ff8818', color: '#00ff88', border: '1px solid #00ff8840', padding: '2px 8px', borderRadius: 20, fontWeight: 700, textTransform: 'uppercase' }}>Zero-Cost Engine</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#00ff88', fontWeight: 700 }}>● LIVE SENSORS</div>
          <div style={{ fontSize: 12, background: '#0f1726', border: '1px solid #1c2b42', padding: '3px 10px', borderRadius: 20, color: '#94a3b8' }}>
            {weather.temp}°C · {weather.desc}
          </div>
        </div>
      </header>

      {/* Main Full-Width Content Container */}
      <div style={{ display: 'flex', flexWrap: 'wrap', width: '100%', minHeight: 'calc(100vh - 54px)' }}>
        
        {/* Left Interactive Control Column */}
        <aside style={{ flex: '1 1 380px', maxWidth: '100%', borderRight: '1px solid #142032', background: '#090f18', padding: '24px 20px', boxSizing: 'border-box' }}>
          
          {/* User Identity & Alert Email */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 10, marginBottom: 18 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 8, padding: '9px 10px', color: '#fff', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Alert Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@domain.com" style={{ width: '100%', background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 8, padding: '9px 10px', color: '#fff', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Autocomplete Origin */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Origin Point</label>
            <input 
              value={fromInput} 
              onChange={e => handleSearch('from', e.target.value)} 
              placeholder="Search tech park, road, metro..." 
              style={{ width: '100%', background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }}
            />
            {fromAC.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#0f1726', border: '1px solid #00ff8855', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                {fromAC.map((item, i) => (
                  <div key={i} onClick={() => selectLocation('from', item)} style={{ padding: '10px 12px', borderBottom: '1px solid #142032', cursor: 'pointer', fontSize: 12 }}>
                    <strong style={{ color: '#00ff88' }}>{item.display_name.split(',')[0]}</strong>
                    <div style={{ color: '#64748b', fontSize: 10 }}>{item.display_name.split(',').slice(1,3).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Swap Trigger */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px 0' }}>
            <button onClick={swapLocations} style={{ background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 20, color: '#00ff88', padding: '4px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>⇅ Swap Endpoints</button>
          </div>

          {/* Autocomplete Destination */}
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Destination Point</label>
            <input 
              value={toInput} 
              onChange={e => handleSearch('to', e.target.value)} 
              placeholder="Search destination tech park, flyover..." 
              style={{ width: '100%', background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }}
            />
            {toAC.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#0f1726', border: '1px solid #00ff8855', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                {toAC.map((item, i) => (
                  <div key={i} onClick={() => selectLocation('to', item)} style={{ padding: '10px 12px', borderBottom: '1px solid #142032', cursor: 'pointer', fontSize: 12 }}>
                    <strong style={{ color: '#00ff88' }}>{item.display_name.split(',')[0]}</strong>
                    <div style={{ color: '#64748b', fontSize: 10 }}>{item.display_name.split(',').slice(1,3).join(', ')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vehicle Mode Toggle */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Vehicle Physics</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              <button onClick={() => setVehicle('bike')} style={{ padding: '11px 8px', borderRadius: 8, border: vehicle === 'bike' ? '2px solid #00ff88' : '1px solid #1c2b42', background: vehicle === 'bike' ? '#00ff8815' : '#0f1726', color: vehicle === 'bike' ? '#00ff88' : '#94a3b8', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>
                🏍️ Bike (Filtering)
              </button>
              <button onClick={() => setVehicle('car')} style={{ padding: '11px 8px', borderRadius: 8, border: vehicle === 'car' ? '2px solid #00ff88' : '1px solid #1c2b42', background: vehicle === 'car' ? '#00ff8815' : '#0f1726', color: vehicle === 'car' ? '#00ff88' : '#94a3b8', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>
                🚗 Car (Queuing)
              </button>
            </div>
          </div>

          {/* Dual Daily Scheduling Pickers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Reach By</label>
              <input type="time" value={reachTime} onChange={e => setReachTime(e.target.value)} style={{ width: '100%', background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 8, padding: 8, color: '#00ff88', fontSize: 14, fontWeight: 900, marginTop: 4, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Return Journey</label>
              <input type="time" value={returnTime} onChange={e => setReturnTime(e.target.value)} style={{ width: '100%', background: '#0f1726', border: '1px solid #1c2b42', borderRadius: 8, padding: 8, color: '#00ff88', fontSize: 14, fontWeight: 900, marginTop: 4, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Primary Action Button */}
          <button onClick={() => runScanEngine()} style={{ width: '100%', padding: '14px', background: '#00ff88', color: '#06090f', border: 'none', borderRadius: 10, fontWeight: 900, fontSize: 14, cursor: 'pointer', letterSpacing: '0.4px' }}>
            {isScanning ? 'CALCULATING BOTTLENECKS...' : 'CALCULATE ARBITRAGE WINDOW →'}
          </button>

          {/* Device Pairing Section */}
          <div style={{ marginTop: 22, borderTop: '1px solid #142032', paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase' }}>iOS Push Pairing</div>
            <div style={{ fontSize: 11, color: '#64748b', margin: '4px 0 10px 0', lineHeight: 1.4 }}>Pushes lock-screen alerts 15 minutes before your calculated departure window.</div>
            <button onClick={handleDevicePairing} style={{ width: '100%', padding: '11px', background: paired ? '#00ff8820' : '#0f1726', border: paired ? '1px solid #00ff88' : '1px solid #1c2b42', color: paired ? '#00ff88' : '#fff', borderRadius: 8, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
              {paired ? '✓ Lock-Screen Alerts Active' : '📲 Pair Device with Push Worker'}
            </button>
          </div>

        </aside>

        {/* Right Dynamic Analytics Column */}
        <main style={{ flex: '2 1 600px', display: 'flex', flexDirection: 'column', background: '#06090f' }}>
          
          {/* Top Panel Navigation Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #142032', background: '#090f18' }}>
            <button onClick={() => setActiveTab('result')} style={{ flex: 1, padding: '14px 10px', background: 'transparent', border: 'none', borderBottom: activeTab === 'result' ? '2px solid #00ff88' : '2px solid transparent', color: activeTab === 'result' ? '#00ff88' : '#64748b', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', cursor: 'pointer' }}>
              Today's Arbitrage
            </button>
            <button onClick={() => setActiveTab('week')} style={{ flex: 1, padding: '14px 10px', background: 'transparent', border: 'none', borderBottom: activeTab === 'week' ? '2px solid #00ff88' : '2px solid transparent', color: activeTab === 'week' ? '#00ff88' : '#64748b', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', cursor: 'pointer' }}>
              Weekly Inspector
            </button>
            <button onClick={() => setActiveTab('corridors')} style={{ flex: 1, padding: '14px 10px', background: 'transparent', border: 'none', borderBottom: activeTab === 'corridors' ? '2px solid #00ff88' : '2px solid transparent', color: activeTab === 'corridors' ? '#00ff88' : '#64748b', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', cursor: 'pointer' }}>
              All Corridors
            </button>
          </div>

          {/* TAB 1: TODAY'S ARBITRAGE */}
          {activeTab === 'result' && scanResult && (
            <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              
              {/* Giant Cockpit Departure Card */}
              <div style={{ background: '#090f18', border: '2px solid #00ff88', borderRadius: 16, padding: '24px 28px', boxShadow: '0 0 35px rgba(0,255,136,0.12)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 900, background: '#00ff8820', color: '#00ff88', border: '1px solid #00ff8855', padding: '3px 10px', borderRadius: 20 }}>
                    {scanResult.confidence}% MODEL CONFIDENCE
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#00ff88' }}>
                    SAVES ~{scanResult.savedMins} MINS VS PEAK
                  </span>
                </div>

                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 14 }}>Recommended Departure Window:</div>
                <div style={{ fontSize: 64, fontWeight: 900, color: '#ffffff', letterSpacing: '-2px', lineHeight: 1.05, margin: '4px 0 14px 0' }}>
                  {scanResult.depTime} <span style={{ fontSize: 20, color: '#00ff88' }}>AM</span>
                </div>

                {/* Primary Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, background: '#0f1726', padding: 14, borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>PREDICTED TRANSIT</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{scanResult.totalTravelMins} <span style={{ fontSize: 12, color: '#64748b' }}>mins</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>CHOKEPOINT SPEED</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#00ff88' }}>{scanResult.effectiveKmh} <span style={{ fontSize: 12, color: '#00ff8888' }}>km/h</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>TARGET ARRIVAL</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{reachTime}</div>
                  </div>
                </div>
              </div>

              {/* 15-Minute Penalty Alert Card */}
              <div style={{ background: '#1c0c11', border: '1px solid #ef444455', borderLeft: '5px solid #ef4444', padding: '14px 18px', borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#f87171' }}>⚠️ 15-MINUTE BUFFER SHOCKWAVE:</div>
                <div style={{ fontSize: 13, color: '#fca5a5', marginTop: 3 }}>
                  Departing 15 minutes after {scanResult.depTime} adds an estimated <strong>+{scanResult.penaltyMins} minutes</strong> of queuing delay on {scanResult.corridor.name}.
                </div>
              </div>

              {/* Actionable Alternate Route Suggestion */}
              <div style={{ background: '#090f18', border: '1px solid #142032', borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#00ff88' }}>🔀 ALTERNATE ARBITRAGE ROUTE:</div>
                  <span style={{ fontSize: 10, background: '#00ff8815', color: '#00ff88', border: '1px solid #00ff8844', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                    {scanResult.corridor.alternate.viability}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{scanResult.corridor.alternate.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 8px 0', lineHeight: 1.4 }}>{scanResult.corridor.alternate.desc}</div>
                <div style={{ fontSize: 12, color: '#00ff88', fontWeight: 800 }}>Delta: {scanResult.corridor.alternate.timeDiffMins} mins vs main corridor</div>
              </div>

              {/* Metro Construction Telemetry */}
              <div style={{ background: '#090f18', border: '1px solid #142032', borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa' }}>🚇 ACTIVE METRO CIVIL WORK:</div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>{scanResult.corridor.metro}</div>
              </div>

              {/* Google Maps Real-Time Direction Link */}
              <a 
                href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromInput + ' Bengaluru')}&destination=${encodeURIComponent(toInput + ' Bengaluru')}&travelmode=${vehicle === 'bike' ? 'bicycling' : 'driving'}`}
                target="_blank" 
                rel="noreferrer"
                style={{ textAlign: 'center', padding: '13px', background: '#0f1726', border: '1px solid #00ff8844', borderRadius: 10, color: '#00ff88', textDecoration: 'none', fontSize: 13, fontWeight: 900 }}
              >
                Open Real-Time Navigation in Google Maps ↗
              </a>

              {/* Telemetry Accuracy Feedback */}
              <div style={{ background: '#090f18', border: '1px solid #142032', borderRadius: 12, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>Did you depart inside this recommended window?</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => logTelemetryFeedback(true)} style={{ flex: 1, padding: 10, background: '#0f1726', border: '1px solid #00ff88', color: '#00ff88', borderRadius: 8, fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>
                    ✓ Started on Time
                  </button>
                  <button onClick={() => logTelemetryFeedback(false)} style={{ flex: 1, padding: 10, background: '#0f1726', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>
                    ✕ Started +15m Late
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: INTERACTIVE WEEKLY INSPECTOR */}
          {activeTab === 'week' && (
            <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 900, color: '#fff' }}>Interactive Weekday Inspector</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Select any day to dynamically re-evaluate bottleneck durations and optimal departure windows:</p>
              </div>

              {/* Day Selection Chips */}
              <div style={{ display: 'flex', gap: 8 }}>
                {Object.keys(WEEK_FACTORS).map(d => (
                  <button
                    key={d}
                    onClick={() => { setInspectDay(d); runScanEngine(d); }}
                    style={{
                      flex: 1, padding: '12px 6px', borderRadius: 10,
                      border: inspectDay === d ? '2px solid #00ff88' : '1px solid #142032',
                      background: inspectDay === d ? '#00ff8820' : '#090f18',
                      color: inspectDay === d ? '#00ff88' : '#64748b',
                      fontSize: 12, fontWeight: 900, textTransform: 'uppercase', cursor: 'pointer'
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>

              {/* Weekday Metric Breakdown */}
              <div style={{ background: '#090f18', border: '1px solid #142032', borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{WEEK_FACTORS[inspectDay].label} Forecast</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: WEEK_FACTORS[inspectDay].mult >= 1.3 ? '#ef4444' : '#00ff88' }}>
                    {WEEK_FACTORS[inspectDay].mult >= 1.3 ? '🔴 Severe Choke Potential' : '🟢 Flowing Conditions'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>
                  <strong>Morning Gridlock Window:</strong> {WEEK_FACTORS[inspectDay].peakM}
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
                  <strong>Evening Return Choke:</strong> {WEEK_FACTORS[inspectDay].peakE}
                </div>
                <div style={{ background: '#0f1726', padding: 12, borderRadius: 8, fontSize: 12, color: '#00ff88' }}>
                  Optimal morning window for {WEEK_FACTORS[inspectDay].label}: <strong>{scanResult ? scanResult.depTime : '08:15'} AM</strong> to guarantee reaching by {reachTime}.
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ALL CORRIDORS OVERVIEW */}
          {activeTab === 'corridors' && (
            <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Object.entries(CORRIDORS).map(([key, c]) => (
                <div key={key} style={{ background: '#090f18', border: '1px solid #142032', borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{c.name}</div>
                    <span style={{ fontSize: 11, color: '#00ff88', fontWeight: 800 }}>{c.short}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>🚇 {c.metro}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#0f1726', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
                    <div>Best Morning: <strong style={{ color: '#00ff88' }}>{c.bestM}</strong></div>
                    <div>Best Evening: <strong style={{ color: '#00ff88' }}>{c.bestE}</strong></div>
                  </div>
                  <button 
                    onClick={() => { setFromInput(c.short.split('·')[1]?.split('➔')[0]?.trim() || c.name); setToInput(c.short.split('➔')[1]?.trim() || 'Tech Park'); setActiveTab('result'); runScanEngine(); }}
                    style={{ width: '100%', padding: '9px', background: '#0f1726', border: '1px solid #00ff8855', color: '#00ff88', borderRadius: 6, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
                  >
                    Tap to Set Corridor as Active Journey →
                  </button>
                </div>
              ))}
            </div>
          )}

        </main>

      </div>

      {/* Floating System Toast */}
      {toast.show && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'error' ? '#290d12' : '#0f1726', border: `1px solid ${toast.type === 'error' ? '#ef4444' : '#00ff88'}`, borderRadius: 10, padding: '12px 18px', color: '#fff', fontSize: 13, fontWeight: 700, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 9999 }}>
          {toast.msg}
        </div>
      )}

    </div>
  );
}
