// ============================================================
// NK MMO Store V28.7.16 - PARALLEL AUTO TRACKING + TERMINAL STOP
// - Up to 80 tracking codes per run by default.
// - 8 concurrent carrier lookups by default.
// - Atomic Supabase claim/lease prevents overlapping cron runs.
// - Exponential retry backoff on failures.
// - SPX/GHN by tracking code only; no Shopee cookie.
// ============================================================

const crypto = require('crypto');

const DEFAULT_BATCH_SIZE = 80;
const DEFAULT_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_LEASE_SECONDS = 50;

function env(name, required = true) {
  const value = String(process.env[name] || '').trim();
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function digits(v) { return String(v || '').replace(/\D/g, ''); }

function carrierOf(code) {
  code = String(code || '').trim().toUpperCase();
  if (/^SPXVN[A-Z0-9]+$/.test(code)) return 'SPX';
  if (/^[A-Z0-9]{8,20}$/.test(code)) return 'GHN';
  return '';
}

function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctl.signal, cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = d?.error?.message || d?.error || d?.message || `HTTP ${r.status}`;
      throw new Error(String(msg));
    }
    return d;
  } finally {
    clearTimeout(timer);
  }
}

function latestEvent(x) {
  const events = Array.isArray(x?.events) ? x.events :
    Array.isArray(x?.history) ? x.history :
      Array.isArray(x?.tracking) ? x.tracking : [];
  return { events, latest: events[0] || {} };
}

function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function terminalState({ carrier, x, latest, text, code, milestone }) {
  const all = foldText([text, code, milestone, latest?.description, latest?.statusText].filter(Boolean).join(' | '));

  // IMPORTANT: terminal != delivered. GHN can report isTerminal=true for
  // cancelled/returned shipments too, so delivery must be detected separately.
  const delivered =
    x?.delivered === true ||
    /(^|[^a-z])delivered([^a-z]|$)/.test(all) ||
    /giao hang thanh cong/.test(all) ||
    /da giao thanh cong/.test(all) ||
    /da giao hang thanh cong/.test(all);

  const cancelled =
    /da bi huy/.test(all) ||
    /don hang da huy/.test(all) ||
    /don da huy/.test(all) ||
    /(^|[^a-z])cancelled([^a-z]|$)/.test(all) ||
    /(^|[^a-z])canceled([^a-z]|$)/.test(all);

  const returned =
    /hoan tra thanh cong/.test(all) ||
    /da hoan tra thanh cong/.test(all) ||
    /tra hang thanh cong/.test(all) ||
    /returned successfully/.test(all) ||
    /return completed/.test(all);

  const terminal = delivered || cancelled || returned || (carrier === 'GHN' && x?.isTerminal === true);
  const reason = delivered ? 'delivered' : cancelled ? 'cancelled' : returned ? 'returned' : terminal ? 'terminal' : '';
  return { delivered, terminal, reason };
}

function normalizeTrackingResult(carrier, raw) {
  const x = raw?.data || raw || {};
  const { latest } = latestEvent(x);
  if (carrier === 'GHN') {
    const text = x.statusText || latest.statusText || latest.description || x.status || '';
    const code = x.status || latest.status || x.tracking_status_code || '';
    const milestone = latest.description || latest.statusText || x.milestone || '';
    const state = terminalState({ carrier, x, latest, text, code, milestone });
    return {
      tracking_status: text,
      tracking_status_code: code,
      milestone,
      current_location: latest?.location?.name || latest?.location?.address || x.current_location || '',
      next_location: x.next_location || '',
      delivered: state.delivered,
      tracking_finished: state.terminal,
      finished_reason: state.reason,
      last_event_at: toIsoTimestamp(latest.timestamp || x.latestUpdate || x.time)
    };
  }
  const text = x.status || x.statusText || latest.status || latest.statusText || latest.description || '';
  const code = x.tracking_status_code || x.status_code || latest.status_code || latest.status || '';
  const milestone = x.milestone || latest.description || latest.statusText || '';
  const state = terminalState({ carrier, x, latest, text, code, milestone });
  return {
    tracking_status: text,
    tracking_status_code: code,
    milestone,
    current_location: x.current_location || latest?.location?.name || latest?.location?.address || '',
    next_location: x.next_location || '',
    delivered: state.delivered,
    tracking_finished: state.terminal,
    finished_reason: state.reason,
    last_event_at: toIsoTimestamp(x.time || latest.timestamp || x.latestUpdate)
  };
}

function headers(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supabaseGet(base, serviceKey, table, query) {
  return fetchJson(`${base}/rest/v1/${table}?${query}`, { headers: headers(serviceKey, { Accept: 'application/json' }) });
}

async function rpc(base, serviceKey, fn, body) {
  return fetchJson(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(serviceKey, { Accept: 'application/json' }),
    body: JSON.stringify(body)
  });
}

async function patchMinimal(base, serviceKey, table, query, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: headers(serviceKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify(body),
      signal: ctl.signal
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      throw new Error(d?.message || d?.error || `Supabase PATCH HTTP ${r.status}`);
    }
  } finally { clearTimeout(timer); }
}

function getSiteUrl(req) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Cannot determine SITE_URL');
  return `${proto}://${host}`;
}

function nextRetrySeconds(failCount) {
  const n = Math.max(0, Number(failCount || 0));
  return Math.min(900, 60 * Math.pow(2, Math.min(n, 4)));
}

async function releaseRow(base, serviceKey, row, patch = {}) {
  await patchMinimal(
    base,
    serviceKey,
    'shopee_tracking',
    `order_id=eq.${encodeURIComponent(row.order_id)}&user_id=eq.${encodeURIComponent(row.user_id)}`,
    { check_lock_id: null, check_locked_until: null, ...patch }
  );
}

async function processOne({ row, order, siteUrl, supabaseUrl, serviceKey, internalSecret }) {
  const code = String(row.tracking_code || '').trim().toUpperCase();
  const carrier = carrierOf(code);
  const now = new Date();
  const nowIso = now.toISOString();

  if (!carrier) {
    await releaseRow(supabaseUrl, serviceKey, row, {
      last_checked_at: nowIso,
      next_check_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      updated_at: nowIso
    });
    return { order_id: row.order_id, code, carrier: '', ok: false, skipped: 'unknown_carrier' };
  }

  let raw;
  if (carrier === 'SPX') {
    raw = await fetchJson(`${siteUrl}/api/spx?code=${encodeURIComponent(code)}`, { headers: { 'x-nk-internal-secret': internalSecret, Accept: 'application/json' } });
    if (raw?.success === false) throw new Error(raw?.message || raw?.error || 'SPX lookup failed');
  } else {
    const savedPhone4 = digits(order?.phone_last4).slice(-4);
    const recipientDigits = digits(order?.recipient_phone);
    const recipientPhone4 = recipientDigits.length >= 4 ? recipientDigits.slice(-4) : '';
    const phone4 = /^\d{4}$/.test(savedPhone4) ? savedPhone4 : recipientPhone4;
    if (!/^\d{4}$/.test(phone4)) {
      await releaseRow(supabaseUrl, serviceKey, row, {
        last_checked_at: nowIso,
        next_check_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        updated_at: nowIso
      });
      return { order_id: row.order_id, code, carrier, ok: false, skipped: 'missing_phone4' };
    }
    raw = await fetchJson(`${siteUrl}/api/ghn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-nk-internal-secret': internalSecret },
      body: JSON.stringify({ trackingNumber: code, phoneLast4: phone4 })
    });
    if (raw?.success === false) throw new Error(raw?.error?.message || raw?.error || raw?.message || 'GHN lookup failed');
  }

  const result = normalizeTrackingResult(carrier, raw);
  const nextCheck = result.tracking_finished ? null : new Date(now.getTime() + 55 * 1000).toISOString();
  await releaseRow(supabaseUrl, serviceKey, row, {
    tracking_status: result.tracking_status || '',
    tracking_status_code: result.tracking_status_code || '',
    milestone: result.milestone || '',
    current_location: result.current_location || '',
    next_location: result.next_location || '',
    delivered: result.delivered === true,
    tracking_finished: result.tracking_finished === true,
    finished_reason: result.finished_reason || null,
    finished_at: result.tracking_finished ? (result.last_event_at || nowIso) : null,
    last_event_at: result.last_event_at,
    last_checked_at: nowIso,
    next_check_at: nextCheck,
    check_fail_count: 0,
    updated_at: nowIso
  });

  if (result.delivered === true) {
    await patchMinimal(
      supabaseUrl,
      serviceKey,
      'shopee_orders',
      `id=eq.${encodeURIComponent(row.order_id)}&user_id=eq.${encodeURIComponent(row.user_id)}`,
      { status: 'Đã giao', delivered_at: result.last_event_at || nowIso }
    );
  }

  return { order_id: row.order_id, code, carrier, ok: true, delivered: result.delivered === true, finished: result.tracking_finished === true, finished_reason: result.finished_reason || '', status: result.tracking_status || '' };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await worker(items[i], i); }
      catch (e) { results[i] = { __error: e, item: items[i] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
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

    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    const internalSecret = env('TRACKING_INTERNAL_SECRET');
    const siteUrl = getSiteUrl(req);
    const batchSize = clampInt(process.env.CRON_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 200);
    const concurrency = clampInt(process.env.CRON_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 16);
    const leaseSeconds = clampInt(process.env.CRON_LEASE_SECONDS, DEFAULT_LEASE_SECONDS, 20, 120);
    const lockId = crypto.randomUUID();

    const rows = await rpc(supabaseUrl, serviceKey, 'nk_claim_tracking_batch', {
      p_limit: batchSize,
      p_lock_id: lockId,
      p_lease_seconds: leaseSeconds
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(200).json({ success: true, checked: 0, message: 'No pending tracking rows' });
    }

    const ids = [...new Set(rows.map(x => Number(x.order_id)).filter(Number.isFinite))];
    const orderQ = new URLSearchParams();
    orderQ.set('select', 'id,user_id,phone_last4,recipient_phone,status,delivered_at');
    orderQ.set('id', `in.(${ids.join(',')})`);
    const orders = ids.length ? await supabaseGet(supabaseUrl, serviceKey, 'shopee_orders', orderQ.toString()) : [];
    const orderMap = new Map((orders || []).map(o => [String(o.id), o]));

    const rawResults = await runPool(rows, concurrency, async row => {
      return processOne({ row, order: orderMap.get(String(row.order_id)) || null, siteUrl, supabaseUrl, serviceKey, internalSecret });
    });

    const results = [];
    for (const rr of rawResults) {
      if (!rr?.__error) { results.push(rr); continue; }
      const row = rr.item;
      const e = rr.__error;
      const failCount = Math.max(0, Number(row?.check_fail_count || 0)) + 1;
      const retrySeconds = nextRetrySeconds(failCount - 1);
      const now = new Date();
      try {
        await releaseRow(supabaseUrl, serviceKey, row, {
          last_checked_at: now.toISOString(),
          next_check_at: new Date(now.getTime() + retrySeconds * 1000).toISOString(),
          check_fail_count: failCount,
          updated_at: now.toISOString()
        });
      } catch (_) {}
      results.push({
        order_id: row?.order_id,
        code: String(row?.tracking_code || ''),
        carrier: carrierOf(row?.tracking_code),
        ok: false,
        retry_after_seconds: retrySeconds,
        error: e?.name === 'AbortError' ? 'Tracking request timeout' : String(e?.message || e)
      });
    }

    const ok = results.filter(x => x.ok).length;
    const delivered = results.filter(x => x.delivered).length;
    const finished = results.filter(x => x.finished).length;
    const skipped = results.filter(x => x.skipped).length;
    const failed = results.length - ok - skipped;

    return res.status(200).json({
      success: true,
      batch_size: batchSize,
      concurrency,
      claimed: rows.length,
      checked: results.length,
      ok,
      delivered,
      finished,
      skipped,
      failed,
      results
    });
  } catch (e) {
    console.error('AUTO TRACKING CRON:', e);
    return res.status(500).json({ success: false, error: String(e?.message || e) });
  }
};
