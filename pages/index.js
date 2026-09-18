'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function CommuterDashboard() {
  const [email, setEmail] = useState('test@commuter.com');
  const [subscribed, setSubscribed] = useState(false);
  const [agentLogs, setAgentLogs] = useState([]);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Detect iOS & standalone mode
    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);

    // Fetch latest agent decisions from Supabase
    fetchLatestLogs();
  }, []);

  async function fetchLatestLogs() {
    const { data } = await supabase
      .from('agent_eval_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);
    if (data) setAgentLogs(data);
  }

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push not supported. On iOS, tap Share -> "Add to Home Screen" first.');
      return;
    }

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission denied.');
      return;
    }

    // Convert VAPID key
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4);
    const base64 = (vapidKey + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const appServerKey = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) appServerKey[i] = rawData.charCodeAt(i);

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey
    });

    // Save device token to Supabase
    await supabase
      .from('commute_plans')
      .update({ push_subscription: subscription.toJSON(), alerts_enabled: true })
      .eq('user_email', email);

    setSubscribed(true);
    alert('iPhone paired. You will receive morning corridor alerts.');
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <h2>BLR Corridor Arbitrage</h2>

      {/* iOS Standalone Warning */}
      {isIOS && !isStandalone && (
        <div style={{ background: '#fff3cd', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          ⚠️ To receive alerts on iPhone: Tap <strong>Share</strong> (bottom of Safari) and select <strong>"Add to Home Screen"</strong>.
        </div>
      )}

      {/* Active Corridor Card */}
      <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <h4>Active Corridor</h4>
        <p><strong>Route:</strong> Indiranagar Metro ➔ Ecospace Bellandur</p>
        <p><strong>Target Departure:</strong> 08:30 AM</p>
        <input 
          type="email" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)} 
          style={{ width: '100%', padding: 8, marginBottom: 12 }}
        />
        <button 
          onClick={enablePush} 
          style={{ width: '100%', padding: 12, background: subscribed ? '#28a745' : '#0070f3', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 'bold' }}>
          {subscribed ? '✓ Notifications Active' : 'Enable iPhone Lock-Screen Alerts'}
        </button>
      </div>

      {/* Backend Intelligence / Agent Audit Feed */}
      <div style={{ border: '1px solid #ddd', padding: 16, borderRadius: 8 }}>
        <h4>Agent Intelligence Feed (Backend Status)</h4>
        {agentLogs.length === 0 ? (
          <p style={{ color: '#666' }}>Awaiting next scheduled morning cron run...</p>
        ) : (
          agentLogs.map((log) => (
            <div key={log.id} style={{ borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 8, fontSize: 14 }}>
              <div><strong>Decision:</strong> <span style={{ color: log.eval_decision === 'PASS' ? 'green' : 'red' }}>{log.eval_decision}</span> (Score: {log.eval_total_score}/100)</div>
              <div style={{ color: '#555' }}><strong>Reasoning:</strong> {log.eval_reason}</div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
