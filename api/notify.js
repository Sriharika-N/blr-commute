export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, message, autoSend, apiKey } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone number and message are required' });
  }

  const sanitizedPhone = phone.replace(/[^0-9]/g, '');

  // Option A: Free Server-to-Phone direct automated dispatch via CallMeBot API (if user configured key)
  if (autoSend && apiKey) {
    try {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${sanitizedPhone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
      const response = await fetch(url);
      if (response.ok) {
        return res.status(200).json({ success: true, mode: 'automated' });
      }
    } catch (err) {
      console.error('CallMeBot delivery error:', err);
    }
  }

  // Option B: Standard Zero-Cost Instant WhatsApp Deep Link
  const waLink = `https://api.whatsapp.com/send?phone=${sanitizedPhone}&text=${encodeURIComponent(message)}`;
  return res.status(200).json({ success: true, mode: 'deeplink', url: waLink });
}
