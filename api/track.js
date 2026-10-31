// ============================================================
// NK MMO Store V28.7.14 - USER TRACKING GATE + ANTI-SPAM
// Public browser tracking goes through this endpoint.
// - Requires a valid Supabase user session.
// - DB-backed rate limits by user + IP + tracking code.
// - Forwards to the existing /api/spx and /api/ghn endpoints.
// ============================================================

const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 15000;
const USER_BURST_LIMIT = 20;      // 20 requests / 10s per user
const USER_MINUTE_LIMIT = 100;    // 100 requests / 60s per user
const IP_MINUTE_LIMIT = 160;      // 160 requests / 60s per IP
const CODE_COOLDOWN_SECONDS = 8;  // same user + same code max once / 8s

function env(name, required = true) {
  const value = String(process.env[name] || '').trim();
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function digits(v) { return String(v || '').replace(/\D/g, ''); }

function carrierOf(code) {
  code = String(code || '').trim().toUpperCase();
  if (/^SPXVN[A-Z0-9]+$/.test(code)) return 'SPX';
  if (/^[A-Z0-9]{8,20}$/.test(code)) return 'GHN';
  return '';
}

function getSiteUrl(req) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Cannot determine SITE_URL');
  return `${proto}://${host}`;
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.socket?.remoteAddress || 'unknown');
}

function h(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctl.signal, cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = d?.error?.message || d?.error || d?.message || `HTTP ${r.status}`;
      const err = new Error(String(msg));
      err.status = r.status;
      throw err;
    }
    return d;
  } finally {
    clearTimeout(timer);
  }
}

async function getSupabaseUser(supabaseUrl, serviceKey, authHeader) {
  if (!/^Bearer\s+\S+/i.test(authHeader || '')) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceKey,
        Authorization: authHeader,
        Accept: 'application/json'
      },
      signal: ctl.signal,
      cache: 'no-store'
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return d?.id ? d : null;
  } finally {
    clearTimeout(timer);
  }
}

async function takeQuota(supabaseUrl, serviceKey, key, windowSeconds, limit) {
  const r = await fetchJson(`${supabaseUrl}/rest/v1/rpc/nk_take_tracking_quota`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      p_key: key,
      p_window_seconds: windowSeconds,
      p_limit: limit
    })
  }, 8000);
  return r || { allowed: false, retry_after: windowSeconds };
}

function send429(res, quota, scope) {
  const retry = Math.max(1, Number(quota?.retry_after || 1));
  res.setHeader('Retry-After', String(retry));
  return res.status(429).json({
    success: false,
    error: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    retry_after: retry,
    scope
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      return res.status(413).json({ success: false, error: 'Request quá lớn.' });
    }

    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    const internalSecret = env('TRACKING_INTERNAL_SECRET');
    const authHeader = String(req.headers.authorization || '');

    // Global pre-auth IP gate: protects Supabase Auth from anonymous request floods.
    const ip = clientIp(req);
    const preAuthQuota = await takeQuota(supabaseUrl, serviceKey, `preip60:${h(ip)}`, 60, 240);
    if (preAuthQuota?.allowed !== true) return send429(res, preAuthQuota, 'preauth_ip');

    const user = await getSupabaseUser(supabaseUrl, serviceKey, authHeader);
    if (!user) return res.status(401).json({ success: false, error: 'Phiên đăng nhập không hợp lệ.' });

    const code = String(req.body?.trackingCode || req.body?.code || '').trim().toUpperCase();
    const phone4 = digits(req.body?.phoneLast4 || req.body?.phone4).slice(-4);
    const carrier = carrierOf(code);
    if (!carrier) return res.status(400).json({ success: false, error: 'Mã vận đơn không hợp lệ.' });
    if (carrier === 'GHN' && !/^\d{4}$/.test(phone4)) {
      return res.status(400).json({ success: false, error: 'GHN cần đúng 4 số cuối SĐT.' });
    }

    const uid = String(user.id);
    const checks = [
      ['user_burst', `u10:${h(uid)}`, 10, USER_BURST_LIMIT],
      ['user_minute', `u60:${h(uid)}`, 60, USER_MINUTE_LIMIT],
      ['ip_minute', `ip60:${h(ip)}`, 60, IP_MINUTE_LIMIT],
      ['same_code', `code:${h(uid + ':' + code)}`, CODE_COOLDOWN_SECONDS, 1]
    ];

    for (const [scope, key, seconds, limit] of checks) {
      const quota = await takeQuota(supabaseUrl, serviceKey, key, seconds, limit);
      if (quota?.allowed !== true) return send429(res, quota, scope);
    }

    const siteUrl = getSiteUrl(req);
    let data;
    if (carrier === 'SPX') {
      data = await fetchJson(`${siteUrl}/api/spx?code=${encodeURIComponent(code)}`, { headers: { 'x-nk-internal-secret': internalSecret, Accept: 'application/json' } });
    } else {
      data = await fetchJson(`${siteUrl}/api/ghn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-nk-internal-secret': internalSecret },
        body: JSON.stringify({ trackingNumber: code, phoneLast4: phone4 })
      });
    }

    return res.status(200).json(data);
  } catch (e) {
    if (e?.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Dịch vụ vận chuyển phản hồi quá lâu.' });
    }
    console.error('TRACK GATE:', e);
    return res.status(Number(e?.status) || 500).json({ success: false, error: String(e?.message || e) });
  }
};
