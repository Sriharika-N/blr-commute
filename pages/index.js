async function subscribeToAlerts(userEmail, originName, destName, leaveTime, originCoords, destCoords) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications not supported on this browser.');
    return;
  }

  // 1. Register service worker
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  // 2. Request user permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Permission not granted for alerts.');
    return;
  }

  // 3. Convert public VAPID key
  const convertedVapidKey = urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

  // 4. Subscribe to PushManager
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertedVapidKey
  });

  // 5. Upsert to Supabase
  await supabase
    .from('commute_plans')
    .upsert({
      user_email: userEmail,
      origin_name: originName,
      dest_name: destName,
      leave_home_time: leaveTime,
      origin_lat: originCoords.lat,
      origin_lng: originCoords.lng,
      dest_lat: destCoords.lat,
      dest_lng: destCoords.lng,
      push_subscription: subscription.toJSON(),
      alerts_enabled: true
    }, { onConflict: 'user_email' });

  alert('Corridor alerts subscribed successfully!');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
