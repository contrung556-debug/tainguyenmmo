// ============================================================
// NK MMO Store V28.7.21 - Telegram webhook setup
// Protected by the existing CRON_SECRET. POST only.
// ============================================================

function env(name, required = true) {
  const value = String(process.env[name] || '').trim();
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getSiteUrl(req) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Cannot determine SITE_URL');
  return `${proto}://${host}`;
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
    cache: 'no-store'
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.ok !== true) throw new Error(d?.description || `Telegram ${method} HTTP ${r.status}`);
  return d.result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const cronSecret = env('CRON_SECRET');
    if (String(req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const token = env('TELEGRAM_BOT_TOKEN');
    const webhookSecret = env('TELEGRAM_WEBHOOK_SECRET');
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
      throw new Error('TELEGRAM_WEBHOOK_SECRET must use only A-Z a-z 0-9 _ - and be 1-256 chars');
    }

    const siteUrl = getSiteUrl(req);
    const webhookUrl = `${siteUrl}/api/telegram/webhook`;

    const result = await tg(token, 'setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: false,
      max_connections: 20
    });

    await tg(token, 'setMyCommands', {
      commands: [
        { command: 'track', description: 'Tra cứu mã vận đơn ngay' },
        { command: 'order', description: 'Xem đơn NK Store theo mã đơn' },
        { command: 'watch', description: 'Theo dõi và báo khi trạng thái đổi' },
        { command: 'unwatch', description: 'Dừng theo dõi mã vận đơn' },
        { command: 'list', description: 'Danh sách mã đang theo dõi' },
        { command: 'me', description: 'Xem gói và quyền tài khoản' },
        { command: 'id', description: 'Xem Telegram chat ID' },
        { command: 'help', description: 'Hướng dẫn sử dụng' }
      ]
    });

    const info = await tg(token, 'getWebhookInfo', {});
    return res.status(200).json({ success: true, setWebhook: result, webhook: info });
  } catch (e) {
    console.error('TELEGRAM SETUP:', e);
    return res.status(500).json({ success: false, error: String(e?.message || e) });
  }
};
