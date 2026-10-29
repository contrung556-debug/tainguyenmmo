// ============================================================
// NK MMO STORE - ICLOUD CUSTOM DOMAIN MAIL API
// VERSION: MAIL-1.4.1
//
// Purpose:
// - Read OTP/link for @icloud.com and @nkstore.io.vn through iCloud IMAP
// - Facebook / Shopee / TikTok
// - Search INBOX + Junk/Spam
// - Keep MAIL_API_KEY server-side
// - Web users authenticate with existing Supabase session token
// - No wallet deduction / no OTP billing
//
// GET /api/mail?email=alias@icloud.com or abc@nkstore.io.vn
// Web header: Authorization: Bearer <supabase_access_token>
// External/server header: x-api-key: <MAIL_API_KEY>
//
// Vercel env already used:
// - ICLOUD_USER
// - ICLOUD_APP_PASSWORD
// - MAIL_API_KEY
// ============================================================

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');

const ALLOWED_DOMAINS = ['@icloud.com', '@nkstore.io.vn'];
const MAX_MESSAGES = 100;

// Public project identifiers. These are already present in index.html.
// Optional env values can override them later without changing source.
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://hsdbjzkxbdezysxwwtaw.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_LIeDI4UVn7MEo5vURP05hA_TM4h0vFd';

const supabaseAuth = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanHeader(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
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
  ) {
    return 'facebook';
  }

  if (
    all.includes('shopee') ||
    all.includes('shopee.vn') ||
    all.includes('shopee.com')
  ) {
    return 'shopee';
  }

  if (
    all.includes('tiktok') ||
    all.includes('tiktok.com') ||
    all.includes('bytedance')
  ) {
    return 'tiktok';
  }

  return 'unknown';
}

function extractOtp(text = '', provider = 'unknown') {
  const source = String(text || '');

  // Prefer codes next to OTP/verification wording.
  const contextual = [
    /(?:confirmation\s*code|verification\s*code|security\s*code|verify\s*code|login\s*code|one[-\s]*time\s*(?:password|code)|otp|mã\s*xác\s*nhận|mã\s*xác\s*minh|mã\s*bảo\s*mật|mã\s*otp)[^\d]{0,100}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,100}(?:confirmation\s*code|verification\s*code|security\s*code|login\s*code|otp|mã\s*xác\s*nhận|mã\s*xác\s*minh|mã\s*bảo\s*mật)/i,
  ];

  for (const pattern of contextual) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Provider-specific fallback.
  const specific = {
    facebook: [
      /(?:facebook|meta)[\s\S]{0,350}?\b(\d{5,8})\b/i,
      /\b(\d{5,8})\b[\s\S]{0,180}?(?:facebook|meta)/i,
    ],
    shopee: [
      /shopee[\s\S]{0,350}?\b(\d{4,8})\b/i,
      /\b(\d{4,8})\b[\s\S]{0,180}?shopee/i,
    ],
    tiktok: [
      /tiktok[\s\S]{0,350}?\b(\d{4,8})\b/i,
      /\b(\d{4,8})\b[\s\S]{0,180}?tiktok/i,
    ],
  }[provider] || [];

  for (const pattern of specific) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Last resort: usual OTP lengths, longest confidence first.
  for (const pattern of [
    /\b(\d{6})\b/,
    /\b(\d{5})\b/,
    /\b(\d{4})\b/,
    /\b(\d{7})\b/,
    /\b(\d{8})\b/,
  ]) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function extractLinks(text = '') {
  const links = String(text || '').match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
  return [...new Set(links)]
    .map((url) => url.replace(/&amp;/gi, '&').replace(/[.,;]+$/, ''))
    .slice(0, 20);
}

function verificationContext(text = '') {
  return /(?:verify|verification|confirm|confirmation|security|login|one[-\s]*time|otp|code|activate|activation|xác\s*nhận|xác\s*minh|mã\s*(?:otp|xác|bảo\s*mật))/i.test(
    String(text || '')
  );
}

function pickVerificationLinks(links = [], provider = 'unknown', context = '') {
  const providerHints = {
    facebook: ['facebook.com', 'facebookmail.com', 'meta.com'],
    shopee: ['shopee.vn', 'shopee.com'],
    tiktok: ['tiktok.com', 'byteoversea.com'],
  }[provider] || [];

  const noise = /(?:unsubscribe|privacy|terms|help|support|preferences|notification-settings|legal)/i;
  const verify = /(?:verify|verification|confirm|confirmation|activate|activation|security|checkpoint|login|auth|code|email)/i;
  const contextLooksRight = verificationContext(context);

  const ranked = (Array.isArray(links) ? links : [])
    .filter((url) => url && !noise.test(url))
    .map((url, index) => {
      const lower = String(url).toLowerCase();
      let score = 0;
      if (verify.test(lower)) score += 6;
      if (providerHints.some((hint) => lower.includes(hint))) score += 3;
      if (contextLooksRight) score += 1;
      return { url, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.url);

  return [...new Set(ranked)].slice(0, 5);
}

function getRecipients(parsed) {
  const recipients = [];

  for (const group of [parsed.to?.value, parsed.cc?.value, parsed.bcc?.value]) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (item?.address) recipients.push(normalize(item.address));
    }
  }

  for (const name of [
    'delivered-to',
    'x-original-to',
    'x-envelope-to',
    'original-recipient',
    'envelope-to',
    'apparently-to',
  ]) {
    const header = cleanHeader(parsed.headers.get(name)).toLowerCase();
    const found = header.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    for (const email of found) recipients.push(normalize(email));
  }

  return [...new Set(recipients)];
}

async function authorize(req) {
  // 1) External/server use can authenticate with the secret API key.
  const expectedApiKey = String(process.env.MAIL_API_KEY || '');
  const suppliedApiKey = String(req.headers['x-api-key'] || '');
  if (expectedApiKey && suppliedApiKey && suppliedApiKey === expectedApiKey) {
    return { ok: true, type: 'api-key', user: null };
  }

  // 2) The website uses the user's existing Supabase login session.
  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return { ok: false };

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) return { ok: false };
    return { ok: true, type: 'supabase', user: data.user };
  } catch (_) {
    return { ok: false };
  }
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

async function searchMailbox(client, mailboxName, targetEmail) {
  let lock = null;

  try {
    lock = await client.getMailboxLock(mailboxName);
    const total = Number(client.mailbox?.exists || 0);
    if (!total) return null;

    const start = Math.max(1, total - MAX_MESSAGES + 1);
    const messages = [];

    for await (const message of client.fetch(`${start}:*`, {
      uid: true,
      envelope: true,
      source: true,
      internalDate: true,
    })) {
      messages.push(message);
    }

    messages.reverse(); // newest first

    for (const message of messages) {
      if (!message.source) continue;

      let parsed;
      try {
        parsed = await simpleParser(message.source);
      } catch (_) {
        continue;
      }

      const recipients = getRecipients(parsed);
      const rawSource = message.source.toString('utf8').toLowerCase();

      // Catch-all messages usually retain the requested alias in To or headers.
      // Raw source fallback covers iCloud header variations.
      if (
        targetEmail &&
        !recipients.includes(targetEmail) &&
        !rawSource.includes(targetEmail)
      ) {
        continue;
      }

      const provider = detectProvider(parsed);
      if (!['facebook', 'shopee', 'tiktok'].includes(provider)) continue;

      const plainText = String(parsed.text || '');
      const htmlText = htmlToText(parsed.html);
      const bodyText = [parsed.subject || '', plainText, htmlText].join('\n');
      const otp = extractOtp(bodyText, provider);
      const allLinks = extractLinks([plainText, parsed.html || ''].join('\n'));
      const links = pickVerificationLinks(allLinks, provider, bodyText);

      // Do not count a normal marketing/account email as a successful OTP lookup.
      if (!otp && !links.length) continue;

      return {
        mailbox: mailboxName,
        uid: message.uid,
        provider,
        from: parsed.from?.value?.[0]?.address || null,
        from_name: parsed.from?.value?.[0]?.name || null,
        to: recipients,
        subject: parsed.subject || null,
        date: parsed.date || message.internalDate || null,
        otp,
        links,
        text: plainText.trim().slice(0, 12000),
      };
    }

    return null;
  } finally {
    if (lock) lock.release();
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    return res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập hoặc cung cấp API key hợp lệ.',
    });
  }

  const targetEmail = normalize(req.query?.email);
  if (!targetEmail) {
    return res.status(400).json({
      ok: false,
      error: 'EMAIL_REQUIRED',
      message: 'Thiếu email cần lấy OTP.',
    });
  }

  if (!ALLOWED_DOMAINS.some((domain) => targetEmail.endsWith(domain))) {
    return res.status(400).json({
      ok: false,
      error: 'INVALID_DOMAIN',
      message: `API này chỉ đọc email ${ALLOWED_DOMAINS.join(' hoặc ')}.`,
    });
  }

  const user = String(process.env.ICLOUD_USER || '').trim();
  const password = String(process.env.ICLOUD_APP_PASSWORD || '').trim();

  if (!user || !password) {
    return res.status(500).json({
      ok: false,
      error: 'MISSING_ICLOUD_ENV',
      message: 'Thiếu ICLOUD_USER hoặc ICLOUD_APP_PASSWORD trên Vercel.',
    });
  }

  const client = new ImapFlow({
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    auth: { user, pass: password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });

  try {
    await client.connect();

    const mailboxes = await findMailboxes(client);
    const found = [];

    for (const mailbox of mailboxes) {
      try {
        const mail = await searchMailbox(client, mailbox, targetEmail);
        if (mail) found.push(mail);
      } catch (error) {
        console.error('MAILBOX_ERROR:', mailbox, error?.message || error);
      }
    }

    if (!found.length) {
      return res.status(404).json({
        ok: false,
        error: 'MAIL_NOT_FOUND',
        message: 'Chưa tìm thấy thư Facebook, Shopee hoặc TikTok mới cho email này.',
        email: targetEmail,
        searched: mailboxes,
      });
    }

    found.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const newest = found[0];

    return res.status(200).json({
      ok: true,
      requested_email: targetEmail,
      provider: newest.provider,
      otp: newest.otp,
      links: newest.links,
      mail: newest,
    });
  } catch (error) {
    console.error('ICLOUD_IMAP_ERROR:', error);
    return res.status(500).json({
      ok: false,
      error: 'ICLOUD_IMAP_ERROR',
      message: error?.message || 'Không thể kết nối iCloud IMAP.',
    });
  } finally {
    try {
      await client.logout();
    } catch (_) {}
  }
};
