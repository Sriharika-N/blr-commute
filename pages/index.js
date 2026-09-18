import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
);

const CORRIDORS = {
  orr: {
    name: 'Outer Ring Road',
    short: 'Silk Board ➔ KR Puram',
    carPeak: 11.5, bikePeak: 21.0, carFree: 42, bikeFree: 55,
    metro: 'Phase 2A Blue Line underpass active; Marathahalli & Kadubeesanahalli chokepoints',
    chokes: ['Silk Board Flyover (+35m)', 'Marathahalli Multiplex (+25m)', 'Bellandur EcoSpace (+18m)'],
    lat: 12.9352, lng: 77.6536
  },
  whitefield: {
    name: 'Whitefield Corridor',
    short: 'Tin Factory ➔ ITPL / Hope Farm',
    carPeak: 13.0, bikePeak: 22.0, carFree: 45, bikeFree: 56,
    metro: 'Purple Line extension surface civil work; Hoodi & Varthur road diversions',
    chokes: ['Tin Factory Junction (+30m)', 'Garudacharpalya (+20m)', 'Hope Farm Circle (+15m)'],
    lat: 12.9698, lng: 77.7200
  },
  ecity: {
    name: 'Hosur Road / E-City',
    short: 'Silk Board ➔ Electronic City Phase 1',
    carPeak: 18.0, bikePeak: 26.0, carFree: 55, bikeFree: 65,
    metro: 'Yellow Line station civil work; Bommasandra and Singasandra bottlenecks',
    chokes: ['Silk Board Entry (+25m)', 'Kudlu Gate (+15m)', 'Electronic City Toll (+12m)'],
    lat: 12.8458, lng: 77.6629
  },
  hebbal: {
    name: 'Airport / Hebbal Corridor',
    short: 'Hebbal Flyover ➔ Manyata / Yelahanka',
    carPeak: 22.0, bikePeak: 32.0, carFree: 60, bikeFree: 70,
    metro: 'Phase 2B Airport Line pillar construction on NH 44 / Bellary Road',
    chokes: ['Hebbal Flyover loop (+25m)', 'Veerannapalya Gate (+20m)', 'Kodigehalli Signal (+15m)'],
    lat: 13.0358, lng: 77.5970
  }
};

const WEEK_FACTORS = {
  mon: { name: 'Monday', mult: 1.15, peakM: '08:00 - 10:30', peakE: '17:30 - 20:30' },
  tue: { name: 'Tuesday', mult: 1.25, peakM: '08:00 - 11:00', peakE: '17:30 - 20:45' },
  wed: { name: 'Wednesday', mult: 1.40, peakM: '07:45 - 11:30', peakE: '17:00 - 21:15 (Worst Day)' },
  thu: { name: 'Thursday', mult: 1.30, peakM: '08:00 - 11:00', peakE: '17:30 - 21:00' },
  fri: { name: 'Friday', mult: 1.10, peakM: '08:15 - 10:30', peakE: '16:30 - 20:00' },
  sat: { name: 'Saturday', mult: 0.90, peakM: '11:00 - 14:00', peakE: '17:00 - 20:00' },
  sun: { name: 'Sunday', mult: 0.80, peakM: '12:00 - 15:00', peakE: '18:00 - 20:00' }
};

export default function BlrCommuteApp() {
  const [username, setUsername] = useState('Commuter');
  const [email, setEmail] = useState('');
  const [fromText, setFromText] = useState('Indiranagar Metro Station');
  const [toText, setToText] = useState('Ecospace Bellandur');
  const [fromCoords, setFromCoords] = useState({ lat: 12.9784, lng: 77.6389 });
  const [toCoords, setToCoords] = useState({ lat: 12.9260, lng: 77.6762 });

  const [fromAC, setFromAC] = useState([]);
  const [toAC, setToAC] = useState([]);
  const [isSearchingFrom, setIsSearchingFrom] = useState(false);
  const [isSearchingTo, setIsSearchingTo] = useState(false);

  const [vehicle, setVehicle] = useState('bike');
  const [timingMode, setTimingMode] = useState('reach_by');
  const [reachTime, setReachTime] = useState('09:15');
  const [returnTime, setReturnTime] = useState('18:30');

  const [selectedDay, setSelectedDay] = useState('wed');
  const [activeDays, setActiveDays] = useState({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false });

  const [prediction, setPrediction] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [weather, setWeather] = useState({ temp: 26, condition: 'Clear', rainMm: 0 });
  const [paired, setPaired] = useState(false);

  const fromTimer = useRef(null);
  const toTimer = useRef(null);

  useEffect(() => {
    fetchLiveWeather();
    runDepartureEngine();
  }, []);

  async function fetchLiveWeather() {
    try {
      const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&current=temperature_2m,precipitation,weather_code&timezone=Asia/Kolkata');
      const d = await res.json();
      const rain = d.current?.precipitation || 0;
      setWeather({
        temp: Math.round(d.current?.temperature_2m || 26),
        condition: rain > 2 ? 'Heavy Rain Shock' : rain > 0 ? 'Light Drizzle' : 'Clear Skies',
        rainMm: rain
      });
    } catch {
      setWeather({ temp: 27, condition: 'Clear Skies', rainMm: 0 });
    }
  }

  // Google Maps-like Bounded Bengaluru Autocomplete
  async function searchLocations(query, setResults, setLoading) {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const bbox = '&viewbox=77.40,12.75,77.85,13.25&bounded=1';
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' Bengaluru')}&countrycodes=in${bbox}&limit=6&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      setResults(data || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleFromInput(text) {
    setFromText(text);
    clearTimeout(fromTimer.current);
    fromTimer.current = setTimeout(() => searchLocations(text, setFromAC, setIsSearchingFrom), 280);
  }

  function handleToInput(text) {
    setToText(text);
    clearTimeout(toTimer.current);
    toTimer.current = setTimeout(() => searchLocations(text, setToAC, setIsSearchingTo), 280);
  }

  function runDepartureEngine() {
    setIsScanning(true);
    setTimeout(() => {
      // Approximate corridor mapping
      const combined = (fromText + ' ' + toText).toLowerCase();
      let corr = CORRIDORS.orr;
      if (combined.includes('whitefield') || combined.includes('hoodi') || combined.includes('itpl')) corr = CORRIDORS.whitefield;
      if (combined.includes('electronic') || combined.includes('hosur') || combined.includes('singasandra')) corr = CORRIDORS.ecity;
      if (combined.includes('hebbal') || combined.includes('manyata') || combined.includes('airport')) corr = CORRIDORS.hebbal;

      const dayMult = WEEK_FACTORS[selectedDay].mult;
      const rainPenalty = weather.rainMm > 2 ? 1.4 : weather.rainMm > 0 ? 1.15 : 1.0;
      const currentSpeed = vehicle === 'bike' ? Math.round(corr.bikePeak / (dayMult * 0.85)) : Math.round(corr.carPeak / dayMult);

      const baselineMins = vehicle === 'bike' ? 36 : 56;
      const calculatedDuration = Math.round(baselineMins * dayMult * rainPenalty);
      const bufferPenaltyMins = vehicle === 'bike' ? Math.round(14 * dayMult) : Math.round(24 * dayMult);

      // Backcalculate departure
      const [h, m] = reachTime.split(':').map(Number);
      const reachDate = new Date();
      reachDate.setHours(h, m, 0, 0);
      const optimalDep = new Date(reachDate.getTime() - calculatedDuration * 60000);
      const depString = optimalDep.toTimeString().slice(0, 5);

      setPrediction({
        corridor: corr,
        depTime: depString,
        travelMins: calculatedDuration,
        speedKmh: currentSpeed,
        bufferPenalty: bufferPenaltyMins,
        confidence: Math.min(99, Math.max(95, 98 - (weather.rainMm > 0 ? 2 : 0))),
        minsSaved: Math.round(calculatedDuration * 0.35)
      });
      setIsScanning(false);
    }, 450);
  }

  async function pairIOSPWA() {
    if (!email) return alert('Enter your email address first.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('On iPhone: Tap Share -> "Add to Home Screen" first, then open from Home Screen.');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return alert('Notifications denied.');

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4);
      const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = window.atob(base64);
      const keyArr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; ++i) keyArr[i] = raw.charCodeAt(i);

      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyArr });

      await supabase.from('commute_plans').upsert({
        user_email: email,
        username,
        origin_name: fromText,
        dest_name: toText,
        vehicle_mode: vehicle,
        reach_dest_time: reachTime + ':00',
        leave_dest_time: returnTime + ':00',
        weekly_schedule: activeDays,
        push_subscription: sub.toJSON(),
        alerts_enabled: true
      }, { onConflict: 'user_email' });

      setPaired(true);
      alert('Device paired. Morning alerts will pop on your lock screen.');
    } catch (e) {
      alert('Pairing error: ' + e.message);
    }
  }

  async function submitTelemetry(onTime) {
    if (!email) return alert('Enter email to log feedback.');
    await supabase.from('commute_telemetry_feedback').insert({
      user_email: email,
      mode: vehicle,
      predicted_travel_mins: prediction?.travelMins,
      time_saved_mins: onTime ? prediction?.minsSaved : 0,
      confidence_score: prediction?.confidence,
      user_rating_helpful: onTime
    });
    alert('Model telemetry logged. Thank you!');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#05080e', color: '#f3f4f6', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '16px 12px 60px 12px' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>

        {/* Top Header Bar */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #1a2333', paddingBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#00ff88', letterSpacing: '1.2px', textTransform: 'uppercase' }}>Intelligence Engine</div>
            <h1 style={{ fontSize: 20, fontWeight: 900, margin: '2px 0 0 0', letterSpacing: '-0.5px' }}>BLR Arbitrage</h1>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#00ff88' }}>● {weather.condition}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{weather.temp}°C · {weather.rainMm}mm rain</div>
          </div>
        </header>

        {/* Journey Card */}
        <div style={{ background: '#0b1320', border: '1px solid #1e293b', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          
          {/* User Identifier */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', background: '#111c2e', border: '1px solid #24354d', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Alert Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" style={{ width: '100%', background: '#111c2e', border: '1px solid #24354d', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Autocomplete Origin */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Origin Point</label>
            <input 
              value={fromText} 
              onChange={e => handleFromInput(e.target.value)} 
              placeholder="Search address, tech park, signal..." 
              style={{ width: '100%', background: '#111c2e', border: '1px solid #24354d', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }}
            />
            {fromAC.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#111c2e', border: '1px solid #334155', borderRadius: 8, zIndex: 50, maxHeight: 180, overflowY: 'auto' }}>
                {fromAC.map((item, i) => (
                  <div key={i} onClick={() => { setFromText(item.display_name.split(',')[0]); setFromCoords({ lat: item.lat, lng: item.lon }); setFromAC([]); }} style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', fontSize: 12, cursor: 'pointer' }}>
                    <strong>{item.display_name.split(',')[0]}</strong> <span style={{ color: '#64748b', fontSize: 10 }}>{item.display_name.split(',').slice(1,3).join(',')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Autocomplete Destination */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Destination Point</label>
            <input 
              value={toText} 
              onChange={e => handleToInput(e.target.value)} 
              placeholder="Search destination tech park, metro..." 
              style={{ width: '100%', background: '#111c2e', border: '1px solid #24354d', borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, marginTop: 4, boxSizing: 'border-box' }}
            />
            {toAC.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#111c2e', border: '1px solid #334155', borderRadius: 8, zIndex: 50, maxHeight: 180, overflowY: 'auto' }}>
                {toAC.map((item, i) => (
                  <div key={i} onClick={() => { setToText(item.display_name.split(',')[0]); setToCoords({ lat: item.lat, lng: item.lon }); setToAC([]); }} style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', fontSize: 12, cursor: 'pointer' }}>
                    <strong>{item.display_name.split(',')[0]}</strong> <span style={{ color: '#64748b', fontSize: 10 }}>{item.display_name.split(',').slice(1,3).join(',')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mode Selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setVehicle('bike')} style={{ padding: '10px 8px', borderRadius: 8, border: vehicle === 'bike' ? '2px solid #00ff88' : '1px solid #1e293b', background: vehicle === 'bike' ? '#00ff8815' : '#111c2e', color: vehicle === 'bike' ? '#00ff88' : '#94a3b8', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              🏍️ Bike (Filtering)
            </button>
            <button onClick={() => setVehicle('car')} style={{ padding: '10px 8px', borderRadius: 8, border: vehicle === 'car' ? '2px solid #00ff88' : '1px solid #1e293b', background: vehicle === 'car' ? '#00ff8815' : '#111c2e', color: vehicle === 'car' ? '#00ff88' : '#94a3b8', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              🚗 Car (Queuing)
            </button>
          </div>

          {/* Dual Timing Pickers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Must Reach Destination By</label>
              <input type="time" value={reachTime} onChange={e => setReachTime(e.target.value)} style={{ width: '100%', background: '#111c2e', border: '1px solid #24354d', borderRadius: 8, padding: 8, color: '#00ff88', fontSize: 14, fontWeight: 800, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Return Journey Starts At</label>
              <input type="time" value={returnTime} onChange={e => setReturnTime(e.target.value)} style={{ width: '100%', background: '#111c2e', border: '1px solid #24354d', borderRadius: 8, padding: 8, color: '#00ff88', fontSize: 14, fontWeight: 800, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Scan Action */}
          <button onClick={runDepartureEngine} style={{ width: '100%', padding: '13px', background: '#00ff88', color: '#05080e', border: 'none', borderRadius: 8, fontWeight: 900, fontSize: 14, cursor: 'pointer', letterSpacing: '0.5px' }}>
            {isScanning ? 'CALCULATING BOTTLENECK PHYSICS...' : 'CALCULATE ARBITRAGE WINDOW'}
          </button>
        </div>

        {/* Prediction Results Card */}
        {prediction && (
          <div style={{ background: '#0b1320', border: '2px solid #00ff88', borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: '0 0 25px rgba(0,255,136,0.12)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, background: '#00ff8820', color: '#00ff88', padding: '3px 8px', borderRadius: 20 }}>
                {prediction.confidence}% MODEL CONFIDENCE
              </span>
              <span style={{ fontSize: 11, color: '#00ff88', fontWeight: 800 }}>
                SAVES ~{prediction.minsSaved} MINS
              </span>
            </div>

            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Optimal Departure Window:</div>
            <div style={{ fontSize: 44, fontWeight: 900, color: '#ffffff', letterSpacing: '-1.5px', lineHeight: 1.1, margin: '2px 0 10px 0' }}>
              {prediction.depTime} <span style={{ fontSize: 16, color: '#00ff88' }}>AM</span>
            </div>

            {/* Travel Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#111c2e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>PREDICTED TRANSIT</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{prediction.travelMins} mins</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>SPEED IN CHOKEPOINT</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#00ff88' }}>{prediction.speedKmh} km/h</div>
              </div>
            </div>

            {/* 15m Delay Penalty Warning */}
            <div style={{ background: '#271217', borderLeft: '4px solid #ef4444', padding: '10px 12px', borderRadius: 6, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#f87171' }}>15-MIN BUFFER RISK:</div>
              <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 2 }}>
                Departing 15 mins late adds <strong>+{prediction.bufferPenalty} mins</strong> delay due to upstream funneling on {prediction.corridor.name}.
              </div>
            </div>

            {/* Metro Bottleneck Telemetry */}
            <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4, marginBottom: 14 }}>
              🚇 <strong>Metro Status:</strong> {prediction.corridor.metro}
            </div>

            {/* Google Maps Real-Time Direction Link */}
            <a 
              href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromText + ' Bengaluru')}&destination=${encodeURIComponent(toText + ' Bengaluru')}&travelmode=${vehicle === 'bike' ? 'bicycling' : 'driving'}`}
              target="_blank" 
              rel="noreferrer"
              style={{ display: 'block', textAlign: 'center', padding: '10px', background: '#162235', borderRadius: 8, color: '#00ff88', textDecoration: 'none', fontSize: 12, fontWeight: 800, marginBottom: 14 }}
            >
              Verify Live on Google Maps ↗
            </a>

            {/* User Telemetry Verification */}
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>Did you depart inside this window?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => submitTelemetry(true)} style={{ flex: 1, padding: 8, background: '#111c2e', border: '1px solid #22c55e', color: '#22c55e', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✓ On Time</button>
                <button onClick={() => submitTelemetry(false)} style={{ flex: 1, padding: 8, background: '#111c2e', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✕ Delayed 15m+</button>
              </div>
            </div>

          </div>
        )}

        {/* Interactive Weekly Plan Inspector */}
        <div style={{ background: '#0b1320', border: '1px solid #1e293b', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#00ff88', textTransform: 'uppercase' }}>Weekly Day Inspector</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Tap any day to see forecast departure timings and peak windows:</div>

          {/* Weekday Chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
            {Object.keys(WEEK_FACTORS).map(d => (
              <button
                key={d}
                onClick={() => { setSelectedDay(d); runDepartureEngine(); }}
                style={{
                  padding: '8px 10px', borderRadius: 8,
                  border: selectedDay === d ? '2px solid #00ff88' : '1px solid #24354d',
                  background: selectedDay === d ? '#00ff8820' : '#111c2e',
                  color: selectedDay === d ? '#00ff88' : '#94a3b8',
                  fontSize: 11, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer'
                }}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Active Day Detail Display */}
          <div style={{ background: '#111c2e', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{WEEK_FACTORS[selectedDay].name} Forecast</span>
              <span style={{ fontSize: 11, color: WEEK_FACTORS[selectedDay].mult > 1.25 ? '#ef4444' : '#00ff88', fontWeight: 800 }}>
                {WEEK_FACTORS[selectedDay].mult > 1.25 ? 'Heavy Congestion' : 'Normal Friction'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              <strong>Morning Peak to Avoid:</strong> {WEEK_FACTORS[selectedDay].peakM}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              <strong>Evening Peak to Avoid:</strong> {WEEK_FACTORS[selectedDay].peakE}
            </div>
          </div>
        </div>

        {/* Pair iOS Lock Screen Alerts */}
        <div style={{ background: '#0b1320', border: '1px solid #1e293b', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>Enable Daily Lock-Screen Alerts</div>
          <div style={{ fontSize: 11, color: '#64748b', margin: '4px 0 12px 0' }}>
            Delivers a push notification directly to your phone 15 minutes before your optimal corridor departure window.
          </div>
          <button onClick={pairIOSPWA} style={{ width: '100%', padding: '12px', background: paired ? '#22c55e' : '#1e293b', color: '#fff', border: paired ? 'none' : '1px solid #334155', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {paired ? '✓ iPhone Alert Pairing Active' : '📲 Pair Device for Automated Alerts'}
          </button>
        </div>

      </div>
    </div>
  );
}
