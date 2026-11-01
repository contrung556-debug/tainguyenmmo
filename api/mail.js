// ============================================================
// NK MMO STORE - ICLOUD MAIL API + PERSISTENT CACHE + DEVICE AUTH
// VERSION: MAIL-1.7.0 - V28.8.11 INCREMENTAL UID CACHE
//
// Main changes:
// - Seed up to 100 newest mails once per IMAP mailbox.
// - Persist filtered OTP/link/delivery results in Supabase mail_index.
// - Track UIDVALIDITY + last_uid separately for INBOX/Junk/Spam.
// - After seed, fetch only new UIDs (with a small overlap for resilience).
// - Atomic per-mailbox sync lease prevents concurrent duplicate sync.
// - Cache-first reads: if requested OTP/link is already indexed, no IMAP call.
// - AutoTouch uses revocable x-device-key, NOT MAIL_API_KEY.
// - Master x-api-key remains server/internal only and preserves legacy bypass.
// - Web users still authenticate with Supabase Bearer token.
//
// Requires SQL: nk_mail_cache.sql
//
// GET /api/mail?email=alias@icloud.com[&service=facebook][&after=<ISO|epoch>]
// Web:      Authorization: Bearer <supabase_access_token>
// AutoTouch: x-device-key: <revocable device token>
// Internal: x-api-key: <MAIL_API_KEY>
// ============================================================

const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');

const ALLOWED_DOMAINS = ['@icloud.com', '@nkstore.io.vn'];
const ALLOWED_PROVIDERS = ['facebook', 'shopee', 'tiktok'];
const MAX_MESSAGES = 100;          // initial seed depth
const UID_OVERLAP = 10;            // re-check last N UIDs for crash resilience
const SYNC_MIN_INTERVAL_MS = 1500; // avoid reconnecting to IMAP on every rapid poll
const SYNC_LOCK_SECONDS = 25;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://hsdbjzkxbdezysxwwtaw.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_LIeDI4UVn7MEo5vURP05hA_TM4h0vFd';

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanHeader(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function toSafeBigIntString(value) {
  if (value === null || value === undefined || value === '') return null;
  try { return BigInt(value).toString(); } catch (_) { return String(value); }
}

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function detectProvider(parsed) {
  const from = normalize(parsed.from?.value?.[0]?.address);
  const fromName = normalize(parsed.from?.value?.[0]?.name);
  const subject = normalize(parsed.subject);
  const all = `${from} ${fromName} ${subject}`;

  if (
    all.includes('facebookmail.com') ||
    all.includes('facebook.com') ||
    all.includes('facebook') ||
    all.includes('meta')
  ) return 'facebook';

  if (
    all.includes('shopee') ||
    all.includes('shopee.vn') ||
    all.includes('shopee.com')
  ) return 'shopee';

  if (
    all.includes('tiktok') ||
    all.includes('tiktok.com') ||
    all.includes('bytedance')
  ) return 'tiktok';

  return 'unknown';
}

function extractOtp(text = '') {
  const source = String(text || '');
  const contextual = [
    /(?:confirmation\s*code|verification\s*code|security\s*code|verify\s*code|login\s*code|one[-\s]*time\s*(?:password|code)|otp|mã\s*xác\s*nhận|mã\s*xác\s*minh|mã\s*bảo\s*mật|mã\s*otp)[^\d]{0,120}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,120}(?:confirmation\s*code|verification\s*code|security\s*code|login\s*code|otp|mã\s*xác\s*nhận|mã\s*xác\s*minh|mã\s*bảo\s*mật)/i,
  ];
  for (const pattern of contextual) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch (_) { return _; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch (_) { return _; }
    });
}

function extractAnchors(html = '') {
  const source = String(html || '');
  const anchors = [];
  const re = /<a\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(source))) {
    const href = decodeHtmlEntities(match[2] || match[3] || match[4] || '').trim();
    if (!/^https?:\/\//i.test(href)) continue;
    const label = htmlToText(match[6] || '').replace(/\s+/g, ' ').trim();
    anchors.push({ href, label });
    if (anchors.length >= 80) break;
  }
  return anchors;
}

function normalizeAnchorLabel(value = '') {
  return decodeHtmlEntities(String(value || ''))
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('vi-VN');
}

function pickVerificationLinks({ anchors = [] } = {}) {
  const urls = [];
  for (const item of anchors) {
    const url = String(item?.href || '').trim();
    const label = normalizeAnchorLabel(item?.label || '');
    if (!/^https?:\/\//i.test(url)) continue;
    if (label !== 'tại đây') continue;
    if (!urls.includes(url)) urls.push(url);
    if (urls.length >= 5) break;
  }
  return urls;
}

function parseVndAmount(value = '') {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function extractShopeeDeliverySuccess(text = '', subject = '') {
  const source = String(text || '').replace(/\r/g, '');
  const all = `${String(subject || '')}\n${source}`;

  if (!/(?:đã\s+được\s+giao\s+thành\s+công|giao\s+hàng\s+thành\s+công|đơn\s+hàng[^\n]{0,120}giao\s+thành\s+công)/i.test(all)) {
    return null;
  }

  const orderMatch = all.match(/(?:mã\s+đơn\s+hàng\s*:\s*|đơn\s+hàng\s+)#?([A-Z0-9][A-Z0-9_-]{5,})/i);
  const deliveredDateMatch = all.match(
    /(?:đã\s+được\s+giao\s+thành\s+công|giao\s+hàng\s+thành\s+công)(?:\s+vào)?(?:\s+ngày)?[^\d]{0,20}(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i
  );
  const placedAtMatch = all.match(/ngày\s+đặt\s+hàng\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i);
  const sellerMatch = all.match(/người\s+bán\s*:\s*([^\n]+)/i);
  const totalMatch = all.match(/tổng\s+thanh\s+toán\s*:\s*(?:₫|đ|vnd)?\s*([\d.,]+)/i);

  return {
    status: 'delivered',
    label: 'Đã giao thành công',
    order_code: orderMatch ? orderMatch[1].trim() : null,
    delivered_date: deliveredDateMatch ? deliveredDateMatch[1].trim() : null,
    placed_at: placedAtMatch ? placedAtMatch[1].trim() : null,
    seller: sellerMatch ? sellerMatch[1].trim() : null,
    total_payment: totalMatch ? parseVndAmount(totalMatch[1]) : null,
  };
}

function getRecipients(parsed, rawSource = '') {
  const recipients = [];
  for (const group of [parsed.to?.value, parsed.cc?.value, parsed.bcc?.value]) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (item?.address) recipients.push(normalize(item.address));
    }
  }

  const recipientHeaders = [
    'delivered-to', 'x-original-to', 'x-envelope-to', 'original-recipient',
    'envelope-to', 'apparently-to',
  ];

  for (const name of recipientHeaders) {
    const header = cleanHeader(parsed.headers.get(name)).toLowerCase();
    const found = header.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    for (const email of found) recipients.push(normalize(email));
  }

  // Catch iCloud/catch-all variants that simpleParser may not expose uniformly.
  // Inspect ALL raw headers but only header names that look recipient-related.
  // Explicitly exclude Reply-To so sender addresses are never indexed as recipients.
  if (rawSource) {
    const headerBlock = String(rawSource).split(/\r?\n\r?\n/, 1)[0]
      .replace(/\r?\n[ \t]+/g, ' ');
    const re = /^([^:\r\n]+):\s*(.+)$/gmi;
    let match;
    while ((match = re.exec(headerBlock))) {
      const name = normalize(match[1]);
      if (name === 'reply-to' || name === 'return-path' || name === 'from' || name === 'sender') continue;
      const recipientish =
        name === 'to' || name === 'cc' || name === 'bcc' ||
        name.endsWith('-to') || name.includes('recipient') || name.includes('envelope');
      if (!recipientish) continue;
      const found = String(match[2] || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
      for (const email of found) recipients.push(normalize(email));
    }
  }

  return [...new Set(recipients)];
}

function parseAfter(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    let n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < 1e12) n *= 1000; // epoch seconds -> ms
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function maxIsoDate(...values) {
  const valid = values
    .filter(Boolean)
    .map((v) => new Date(v))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map((d) => d.getTime()))).toISOString();
}

async function authorize(req) {
  // 1) Server/internal master key. Never embed this in AutoTouch.
  const expectedApiKey = String(process.env.MAIL_API_KEY || '');
  const suppliedApiKey = String(req.headers['x-api-key'] || '');
  if (expectedApiKey && suppliedApiKey && suppliedApiKey === expectedApiKey) {
    return { ok: true, type: 'api-key', user: null };
  }

  // 2) Revocable device key for AutoTouch.
  const suppliedDeviceKey = String(req.headers['x-device-key'] || '').trim();
  if (suppliedDeviceKey) {
    if (!supabaseAdmin) return { ok: false, error: 'MISSING_SUPABASE_SERVICE_ROLE_KEY' };
    const tokenHash = sha256(suppliedDeviceKey);
    const { data, error } = await supabaseAdmin.rpc('autotouch_authorize_device', {
      p_token_hash: tokenHash,
    });
    if (error) {
      console.error('DEVICE_AUTH_ERROR:', error.message || error);
      return { ok: false, error: 'DEVICE_AUTH_ERROR' };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: 'INVALID_DEVICE_KEY' };
    if (!row.allowed) {
      return {
        ok: false,
        error: 'RATE_LIMITED',
        retryAfterMs: Number(row.retry_after_ms || 1000),
      };
    }
    return {
      ok: true,
      type: 'device',
      deviceId: row.device_id,
      deviceName: row.device_name,
      user: row.user_id ? { id: row.user_id } : null,
    };
  }

  // 3) Website: existing Supabase login session.
  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return { ok: false, error: 'UNAUTHORIZED' };

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) return { ok: false, error: 'UNAUTHORIZED' };
    return { ok: true, type: 'supabase', user: data.user };
  } catch (_) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }
}

async function resolveRentalAccess(auth, targetEmail, requestedService, requestedRentalId) {
  // Only the true server-to-server master key bypasses rental ownership checks.
  if (auth.type === 'api-key') return { enforced: false };
  if (!targetEmail.endsWith('@icloud.com')) return { enforced: false };
  if (!supabaseAdmin) {
    const err = new Error('MISSING_SUPABASE_SERVICE_ROLE_KEY'); err.status = 500; throw err;
  }

  const now = new Date().toISOString();
  const { data: rental, error: rErr } = await supabaseAdmin
    .from('mail_rentals')
    .select('id,user_id,email,status,started_at,expires_at')
    .ilike('email', targetEmail)
    .eq('status', 'active')
    .gt('expires_at', now)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!rental) return { enforced: false };

  if (!auth.user || String(rental.user_id) !== String(auth.user.id)) {
    const err = new Error('RENTAL_NOT_OWNER'); err.status = 403; throw err;
  }
  if (requestedRentalId && Number(requestedRentalId) !== Number(rental.id)) {
    const err = new Error('INVALID_RENTAL'); err.status = 403; throw err;
  }

  const service = normalize(requestedService);
  if (!ALLOWED_PROVIDERS.includes(service)) {
    const err = new Error('SERVICE_REQUIRED'); err.status = 403; throw err;
  }

  const { data: ent, error: sErr } = await supabaseAdmin
    .from('mail_rental_services')
    .select('service,started_at,expires_at,status')
    .eq('rental_id', rental.id)
    .eq('service', service)
    .eq('status', 'active')
    .gt('expires_at', now)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!ent) { const err = new Error('SERVICE_NOT_RENTED'); err.status = 403; throw err; }

  return { enforced: true, rental, service, startedAt: ent.started_at, expiresAt: ent.expires_at };
}

async function findMailboxes(client) {
  const result = ['INBOX'];
  try {
    const list = await client.list();
    for (const mailbox of list) {
      const specialUse = String(mailbox.specialUse || '').toLowerCase();
      const path = String(mailbox.path || '');
      const lowerPath = path.toLowerCase();
      const isJunk =
        specialUse === '\\junk' ||
        specialUse.includes('junk') ||
        lowerPath === 'junk' ||
        lowerPath.includes('junk') ||
        lowerPath.includes('spam');
      if (isJunk && path && !result.includes(path)) result.push(path);
    }
  } catch (error) {
    console.error('LIST_MAILBOX_ERROR:', error?.message || error);
  }
  return result;
}

function buildIndexedMail(message, parsed, mailboxName, uidValidity) {
  if (!message?.source || !parsed) return null;

  const provider = detectProvider(parsed);
  if (!ALLOWED_PROVIDERS.includes(provider)) return null;

  const recipients = getRecipients(parsed, message.source.toString('utf8'));
  if (!recipients.length) return null;

  const plainText = String(parsed.text || '');
  const htmlText = htmlToText(parsed.html);
  const bodyText = [parsed.subject || '', plainText, htmlText].join('\n');
  const otp = extractOtp(bodyText);
  const anchors = extractAnchors(parsed.html || '');
  const links = pickVerificationLinks({ anchors });
  const delivery = provider === 'shopee'
    ? extractShopeeDeliverySuccess(bodyText, parsed.subject || '')
    : null;

  if (!otp && !links.length && !delivery) return null;

  const msgDate = parsed.date || message.internalDate || new Date();
  const fromEmail = parsed.from?.value?.[0]?.address || null;
  const fromName = parsed.from?.value?.[0]?.name || null;
  const messageId = parsed.messageId || null;

  const dedupeBasis = messageId || [
    provider,
    normalize(fromEmail),
    new Date(msgDate).toISOString(),
    String(parsed.subject || ''),
    otp || '',
    links.join('|'),
    recipients.slice().sort().join(','),
  ].join('\n');

  return {
    mailbox: mailboxName,
    uid_validity: toSafeBigIntString(uidValidity),
    uid: Number(message.uid),
    dedupe_key: sha256(dedupeBasis),
    message_id: messageId,
    recipient_emails: recipients,
    provider,
    from_email: fromEmail,
    from_name: fromName,
    subject: parsed.subject || null,
    mail_date: new Date(msgDate).toISOString(),
    otp,
    links,
    event_type: delivery ? 'delivery_success' : null,
    delivery,
    text: plainText.trim().slice(0, 12000),
    updated_at: new Date().toISOString(),
  };
}

async function upsertIndexedMail(row) {
  if (!row) return { ok: true, skipped: true };
  const { error } = await supabaseAdmin
    .from('mail_index')
    .upsert(row, { onConflict: 'dedupe_key' });
  if (error) return { ok: false, error };
  return { ok: true, skipped: false };
}

async function getSyncState(mailboxName) {
  const { data, error } = await supabaseAdmin
    .from('mail_sync_state')
    .select('mailbox,uid_validity,last_uid,last_checked_at,last_synced_at,locked_until,lock_owner')
    .eq('mailbox', mailboxName)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateSyncState(mailboxName, values) {
  const payload = { ...values, updated_at: new Date().toISOString() };
  const { error } = await supabaseAdmin
    .from('mail_sync_state')
    .update(payload)
    .eq('mailbox', mailboxName);
  if (error) throw error;
}

async function acquireSyncLock(mailboxName, owner) {
  const { data, error } = await supabaseAdmin.rpc('mail_acquire_sync_lock', {
    p_mailbox: mailboxName,
    p_lock_owner: owner,
    p_lock_seconds: SYNC_LOCK_SECONDS,
  });
  if (error) throw error;
  return data === true;
}

async function releaseSyncLock(mailboxName, owner) {
  try {
    await supabaseAdmin.rpc('mail_release_sync_lock', {
      p_mailbox: mailboxName,
      p_lock_owner: owner,
    });
  } catch (_) {}
}

async function resetMailboxCache(mailboxName, uidValidity) {
  const { error: delError } = await supabaseAdmin
    .from('mail_index')
    .delete()
    .eq('mailbox', mailboxName);
  if (delError) throw delError;

  await updateSyncState(mailboxName, {
    uid_validity: toSafeBigIntString(uidValidity),
    last_uid: 0,
    last_checked_at: null,
    last_synced_at: null,
  });
}

async function processMessage(message, mailboxName, uidValidity) {
  if (!message?.source) return { ok: true, relevant: false };
  let parsed;
  try {
    parsed = await simpleParser(message.source);
  } catch (error) {
    console.error('MAIL_PARSE_ERROR:', mailboxName, message.uid, error?.message || error);
    // Raw MIME parse errors are deterministic; mark this UID processed so sync cannot deadlock forever.
    return { ok: true, relevant: false, parseError: true };
  }

  const indexed = buildIndexedMail(message, parsed, mailboxName, uidValidity);
  if (!indexed) return { ok: true, relevant: false };

  const saved = await upsertIndexedMail(indexed);
  if (!saved.ok) {
    console.error('MAIL_INDEX_UPSERT_ERROR:', mailboxName, message.uid, saved.error?.message || saved.error);
    return { ok: false, relevant: true, error: saved.error };
  }
  return { ok: true, relevant: true };
}


async function quickHeaderCandidate(message) {
  if (!message?.headers) return false;
  try {
    const parsed = await simpleParser(message.headers);
    const provider = detectProvider(parsed);
    if (!ALLOWED_PROVIDERS.includes(provider)) return false;
    const recipients = getRecipients(parsed, message.headers.toString('utf8'));
    return recipients.length > 0;
  } catch (_) {
    // If header parsing is weird, fetch the source rather than risk missing a valid OTP.
    return true;
  }
}

async function scanAndPersistRange(client, range, mailboxName, uidValidity, startingSafeUid) {
  // Stage 1: fetch only small headers. This is the server-side/pre-filter layer.
  const metas = await client.fetchAll(range, {
    uid: true,
    headers: true,
    internalDate: true,
  });

  metas.sort((a, b) => Number(a.uid || 0) - Number(b.uid || 0));

  const candidateUids = [];
  const candidateSet = new Set();
  for (const meta of metas) {
    const uid = Number(meta.uid || 0);
    if (!uid) continue;
    if (await quickHeaderCandidate(meta)) {
      candidateUids.push(uid);
      candidateSet.add(uid);
    }
  }

  // Stage 2: fetch full RFC822 source only for candidate provider/recipient mails.
  const sourceMap = new Map();
  if (candidateUids.length) {
    const fullMessages = await client.fetchAll(candidateUids, {
      uid: true,
      source: true,
      internalDate: true,
    }, { uid: true });
    for (const msg of fullMessages) {
      sourceMap.set(Number(msg.uid), msg);
    }
  }

  let safeLastUid = Number(startingSafeUid || 0);
  let processed = 0;
  let relevant = 0;
  let failedUid = null;

  // Advance in UID order. Relevant mail must persist successfully before state can pass it.
  for (const meta of metas) {
    const uid = Number(meta.uid || 0);
    if (!uid) continue;

    if (!candidateSet.has(uid)) {
      processed += 1;
      if (uid > safeLastUid) safeLastUid = uid;
      continue;
    }

    const full = sourceMap.get(uid);
    if (!full) {
      // Message may have been expunged between the header and source fetch.
      processed += 1;
      if (uid > safeLastUid) safeLastUid = uid;
      continue;
    }

    const result = await processMessage(full, mailboxName, uidValidity);
    if (!result.ok) {
      failedUid = uid;
      break;
    }

    processed += 1;
    if (result.relevant) relevant += 1;
    if (uid > safeLastUid) safeLastUid = uid;
  }

  return { processed, relevant, safeLastUid, failedUid, candidateCount: candidateUids.length };
}

async function syncMailbox(client, mailboxName, owner, force = false) {
  const acquired = await acquireSyncLock(mailboxName, owner);
  if (!acquired) return { mailbox: mailboxName, skipped: 'locked' };

  let imapLock = null;
  try {
    let state = await getSyncState(mailboxName);
    const nowMs = Date.now();
    if (!force && state?.last_checked_at) {
      const checkedMs = new Date(state.last_checked_at).getTime();
      if (Number.isFinite(checkedMs) && nowMs - checkedMs < SYNC_MIN_INTERVAL_MS) {
        return { mailbox: mailboxName, skipped: 'recently_checked' };
      }
    }

    imapLock = await client.getMailboxLock(mailboxName, { readOnly: true, acquireTimeout: 10000 });
    const mailbox = client.mailbox;
    const total = Number(mailbox?.exists || 0);
    const uidValidity = toSafeBigIntString(mailbox?.uidValidity);
    const uidNext = Number(mailbox?.uidNext || 1);
    const newestUid = Math.max(0, uidNext - 1);

    state = await getSyncState(mailboxName);
    const oldValidity = state?.uid_validity == null ? null : String(state.uid_validity);
    let lastUid = Number(state?.last_uid || 0);

    const validityChanged = oldValidity !== null && oldValidity !== String(uidValidity);
    const unseeded = !state || oldValidity === null;

    if (validityChanged) {
      await resetMailboxCache(mailboxName, uidValidity);
      lastUid = 0;
    } else if (unseeded) {
      await updateSyncState(mailboxName, {
        uid_validity: uidValidity,
        last_uid: 0,
      });
      lastUid = 0;
    }

    if (!total) {
      await updateSyncState(mailboxName, {
        uid_validity: uidValidity,
        last_uid: 0,
        last_checked_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      });
      return { mailbox: mailboxName, seeded: lastUid === 0, processed: 0, newestUid: 0 };
    }

    // First seed/reset: scan only the newest MAX_MESSAGES by sequence number.
    // Incremental: fetch UIDs from last_uid-overlap through newest.
    let range;
    let isSeed = lastUid === 0;

    if (isSeed) {
      const startSeq = Math.max(1, total - MAX_MESSAGES + 1);
      range = `${startSeq}:*`;
    } else if (newestUid <= lastUid) {
      // UIDNEXT says no new message has been assigned since our last successful sync.
      await updateSyncState(mailboxName, {
        uid_validity: uidValidity,
        last_checked_at: new Date().toISOString(),
      });
      return { mailbox: mailboxName, processed: 0, newestUid, lastUid };
    } else {
      const startUid = Math.max(1, lastUid - UID_OVERLAP + 1);
      range = { uid: `${startUid}:*` };
    }

    const scan = await scanAndPersistRange(
      client,
      range,
      mailboxName,
      uidValidity,
      lastUid
    );

    const processed = scan.processed;
    const relevant = scan.relevant;
    const safeLastUid = scan.safeLastUid;
    const failedUid = scan.failedUid;

    const nowIso = new Date().toISOString();
    await updateSyncState(mailboxName, {
      uid_validity: uidValidity,
      last_uid: safeLastUid,
      last_checked_at: nowIso,
      last_synced_at: failedUid ? state?.last_synced_at || null : nowIso,
    });

    return {
      mailbox: mailboxName,
      seeded: isSeed,
      processed,
      relevant,
      lastUid: safeLastUid,
      newestUid,
      failedUid,
      candidates: scan.candidateCount,
    };
  } finally {
    if (imapLock) imapLock.release();
    await releaseSyncLock(mailboxName, owner);
  }
}

function cacheRowToMail(row) {
  return {
    mailbox: row.mailbox,
    uid: row.uid,
    provider: row.provider,
    from: row.from_email,
    from_name: row.from_name,
    to: row.recipient_emails || [],
    subject: row.subject,
    date: row.mail_date,
    otp: row.otp,
    links: Array.isArray(row.links) ? row.links : [],
    event_type: row.event_type || null,
    delivery: row.delivery || null,
    text: row.text || '',
  };
}

async function findCachedMail(targetEmail, options = {}) {
  let query = supabaseAdmin
    .from('mail_index')
    .select('mailbox,uid,provider,from_email,from_name,recipient_emails,subject,mail_date,otp,links,event_type,delivery,text')
    .contains('recipient_emails', [targetEmail]);

  if (options.provider) query = query.eq('provider', normalize(options.provider));
  if (options.minDate) query = query.gte('mail_date', options.minDate);
  if (options.allowDelivery === false) query = query.is('event_type', null);

  const { data, error } = await query
    .order('mail_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? cacheRowToMail(data) : null;
}

async function isSyncFresh(maxAgeMs = SYNC_MIN_INTERVAL_MS) {
  const { data, error } = await supabaseAdmin
    .from('mail_sync_state')
    .select('mailbox,last_checked_at');
  if (error) throw error;
  if (!Array.isArray(data) || !data.length) return false;
  const now = Date.now();
  return data.every((row) => {
    if (!row.last_checked_at) return false;
    const t = new Date(row.last_checked_at).getTime();
    return Number.isFinite(t) && now - t <= maxAgeMs;
  });
}

function makeImapClient() {
  const user = String(process.env.ICLOUD_USER || '').trim();
  const password = String(process.env.ICLOUD_APP_PASSWORD || '').trim();
  if (!user || !password) {
    const err = new Error('MISSING_ICLOUD_ENV');
    err.status = 500;
    throw err;
  }
  const client = new ImapFlow({
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  client.on('error', (err) => {
    console.error('IMAP_CLIENT_ERROR:', err?.code || '', err?.message || err);
  });
  return client;
}

async function syncAllMailboxes() {
  const client = makeImapClient();
  const owner = `${process.pid || 0}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const results = [];
  try {
    await client.connect();
    const mailboxes = await findMailboxes(client);
    for (const mailbox of mailboxes) {
      try {
        results.push(await syncMailbox(client, mailbox, owner));
      } catch (error) {
        console.error('MAILBOX_SYNC_ERROR:', mailbox, error?.message || error);
        results.push({ mailbox, error: error?.message || String(error) });
      }
    }
    return { mailboxes, results };
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}

async function logRentalAccess(auth, rentalAccess, targetEmail, service, allowed, reason) {
  if (!rentalAccess?.enforced || !supabaseAdmin || !auth.user) return;
  try {
    await supabaseAdmin.from('mail_rental_access_log').insert({
      user_id: auth.user.id,
      rental_id: rentalAccess.rental.id,
      email: targetEmail,
      service: normalize(service),
      action: 'otp',
      allowed,
      reason,
    });
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({
      ok: false,
      error: 'MISSING_SUPABASE_SERVICE_ROLE_KEY',
      message: 'Cần SUPABASE_SERVICE_ROLE_KEY để dùng mail cache/device auth.',
    });
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    if (auth.error === 'RATE_LIMITED') {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((auth.retryAfterMs || 1000) / 1000))));
      return res.status(429).json({
        ok: false,
        error: 'RATE_LIMITED',
        retry_after_ms: auth.retryAfterMs || 1000,
      });
    }
    return res.status(401).json({
      ok: false,
      error: auth.error || 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập hoặc cung cấp device/server key hợp lệ.',
    });
  }

  const targetEmail = normalize(req.query?.email);
  if (!targetEmail) {
    return res.status(400).json({ ok: false, error: 'EMAIL_REQUIRED', message: 'Thiếu email cần lấy OTP.' });
  }
  if (!ALLOWED_DOMAINS.some((domain) => targetEmail.endsWith(domain))) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_DOMAIN',
      message: `API này chỉ đọc email ${ALLOWED_DOMAINS.join(' hoặc ')}.`,
    });
  }

  const requestedService = normalize(req.query?.service);
  if (requestedService && !ALLOWED_PROVIDERS.includes(requestedService)) {
    return res.status(400).json({ ok: false, error: 'INVALID_SERVICE' });
  }

  let rentalAccess;
  try {
    rentalAccess = await resolveRentalAccess(auth, targetEmail, requestedService, req.query?.rental_id);
  } catch (accessError) {
    if (supabaseAdmin && auth.user) {
      try {
        await supabaseAdmin.from('mail_rental_access_log').insert({
          user_id: auth.user.id,
          email: targetEmail,
          service: requestedService,
          action: 'otp',
          allowed: false,
          reason: accessError.message,
        });
      } catch (_) {}
    }
    return res.status(accessError.status || 403).json({
      ok: false,
      error: accessError.message,
      message: accessError.message === 'SERVICE_NOT_RENTED'
        ? 'Bạn chưa thuê dịch vụ này cho mail hiện tại.'
        : accessError.message === 'SERVICE_REQUIRED'
        ? 'Mail đang được thuê. Hãy chọn đúng dịch vụ đã thuê.'
        : accessError.message === 'RENTAL_NOT_OWNER'
        ? 'Mail này đang thuộc phiên thuê của người dùng khác.'
        : accessError.message,
    });
  }

  const explicitAfter = parseAfter(req.query?.after);
  const effectiveProvider = rentalAccess?.enforced ? rentalAccess.service : (requestedService || null);
  const effectiveMinDate = maxIsoDate(explicitAfter, rentalAccess?.enforced ? rentalAccess.startedAt : null);
  const allowDelivery = !rentalAccess?.enforced;
  const cacheOptions = {
    provider: effectiveProvider,
    minDate: effectiveMinDate,
    allowDelivery,
  };

  try {
    // Fast path: an explicit `after` match is already the requested new mail.
    // Without `after`, only trust cache when IMAP state was checked very recently;
    // otherwise sync first so web requests cannot stay indefinitely stale.
    let newest = await findCachedMail(targetEmail, cacheOptions);
    const cacheFreshEnough = newest && (explicitAfter || await isSyncFresh());
    if (cacheFreshEnough) {
      await logRentalAccess(auth, rentalAccess, targetEmail, effectiveProvider, true, 'CACHE_HIT');
      return res.status(200).json({
        ok: true,
        source: 'cache',
        requested_email: targetEmail,
        rental_mode: !!rentalAccess?.enforced,
        rented_service: rentalAccess?.enforced ? rentalAccess.service : null,
        service_expires_at: rentalAccess?.enforced ? rentalAccess.expiresAt : null,
        provider: newest.provider,
        otp: newest.otp,
        links: newest.links,
        event_type: newest.event_type || null,
        delivery: newest.delivery || null,
        mail: newest,
      });
    }

    // Cache miss: check iCloud incrementally. First ever call seeds newest 100.
    const sync = await syncAllMailboxes();

    newest = await findCachedMail(targetEmail, cacheOptions);
    if (!newest) {
      return res.status(404).json({
        ok: false,
        error: 'MAIL_NOT_FOUND',
        message: rentalAccess?.enforced
          ? `Chưa tìm thấy OTP/link ${rentalAccess.service} mới trong thời gian thuê.`
          : 'Chưa tìm thấy thư Facebook, Shopee hoặc TikTok phù hợp cho email này.',
        email: targetEmail,
        after: effectiveMinDate,
        searched: sync.mailboxes,
        sync: sync.results,
      });
    }

    await logRentalAccess(auth, rentalAccess, targetEmail, effectiveProvider, true, 'SYNC_HIT');
    return res.status(200).json({
      ok: true,
      source: 'sync',
      requested_email: targetEmail,
      rental_mode: !!rentalAccess?.enforced,
      rented_service: rentalAccess?.enforced ? rentalAccess.service : null,
      service_expires_at: rentalAccess?.enforced ? rentalAccess.expiresAt : null,
      provider: newest.provider,
      otp: newest.otp,
      links: newest.links,
      event_type: newest.event_type || null,
      delivery: newest.delivery || null,
      mail: newest,
    });
  } catch (error) {
    console.error('MAIL_API_ERROR:', error);
    const code = error?.message === 'MISSING_ICLOUD_ENV' ? 'MISSING_ICLOUD_ENV' : 'MAIL_API_ERROR';
    return res.status(error?.status || 500).json({
      ok: false,
      error: code,
      message: error?.message || 'Không thể đồng bộ mail.',
    });
  }
};
