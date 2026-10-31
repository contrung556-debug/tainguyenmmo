// ============================================================
// NK MMO STORE - ICLOUD MAIL API + RENTAL GUARD
// VERSION: MAIL-1.6.1 - V28.8.9 HOBBY MERGED RENTAL GUARD
//
// Purpose:
// - Read OTP/link for @icloud.com and @nkstore.io.vn through iCloud IMAP
// - Facebook / Shopee / TikTok
// - Search INBOX + Junk/Spam
// - Keep MAIL_API_KEY server-side
// - Web users authenticate with existing Supabase session token
// - No wallet deduction / no OTP billing
// - Only return links whose visible anchor text is exactly “TẠI ĐÂY”
// - Avoid treating dates/times in link-only emails as OTP
// - Detect Shopee delivery-success emails and extract order details
// - V28.8.0: active rental mail requires exact rented service; hides all other providers
// - V28.8.0: rental mode never exposes messages older than service_started_at
//
// GET /api/mail?email=alias@icloud.com[&rental_id=...&service=shopee]
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

const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY ? createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} }
) : null;

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

  // Only accept numbers that are actually tied to OTP / verification-code wording.
  // This intentionally avoids generic "first 4-8 digits" fallbacks because
  // security-link emails often contain dates/times such as 29/10/2026 18:55.
  const contextual = [
    /(?:confirmation\s*code|verification\s*code|security\s*code|verify\s*code|login\s*code|one[-\s]*time\s*(?:password|code)|otp|mã\s*xác\s*nhận|mã\s*xác\s*minh|mã\s*bảo\s*mật|mã\s*otp)[^\d]{0,120}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,120}(?:confirmation\s*code|verification\s*code|security\s*code|login\s*code|otp|mã\s*xác\s*nhận|mã\s*xác\s*minh|mã\s*bảo\s*mật)/i,
  ];

  for (const pattern of contextual) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Facebook commonly places the code directly in the subject, e.g.
  // "18494 là mã xác nhận Facebook của bạn"; the patterns above catch it.
  // Do not guess any other standalone number.
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

function extractLinks(text = '') {
  const links = String(text || '').match(/https?:\/\/[^\s<>"')\]}]+/gi) || [];
  return [...new Set(links)]
    .map((url) => decodeHtmlEntities(url).replace(/[.,;]+$/, ''))
    .slice(0, 30);
}

function extractAnchors(html = '') {
  const source = String(html || '');
  const anchors = [];
  const re = /<a\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;

  while ((match = re.exec(source))) {
    const href = decodeHtmlEntities(match[2] || match[3] || match[4] || '').trim();
    if (!/^https?:\/\//i.test(href)) continue;

    const label = htmlToText(match[6] || '')
      .replace(/\s+/g, ' ')
      .trim();

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
  // Strict rule requested by NKStore:
  // Only the URL attached to visible text exactly “TẠI ĐÂY” is a verification link.
  // Ignore app-store, help, privacy, tracking, logo and every other URL.
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

  const orderMatch =
    all.match(/(?:mã\s+đơn\s+hàng\s*:\s*|đơn\s+hàng\s+)#?([A-Z0-9][A-Z0-9_-]{5,})/i);

  const deliveredDateMatch = all.match(
    /(?:đã\s+được\s+giao\s+thành\s+công|giao\s+hàng\s+thành\s+công)(?:\s+vào)?(?:\s+ngày)?[^\d]{0,20}(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i
  );

  const placedAtMatch = all.match(
    /ngày\s+đặt\s+hàng\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i
  );

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


async function resolveRentalAccess(auth, targetEmail, requestedService, requestedRentalId) {
  // Secret server-to-server API key keeps legacy internal access unchanged.
  if (auth.type === 'api-key') return { enforced:false };
  if (!targetEmail.endsWith('@icloud.com')) return { enforced:false };
  if (!supabaseAdmin) {
    const err = new Error('MISSING_SUPABASE_SERVICE_ROLE_KEY'); err.status=500; throw err;
  }

  const now = new Date().toISOString();
  const { data:rental, error:rErr } = await supabaseAdmin.from('mail_rentals')
    .select('id,user_id,email,status,started_at,expires_at')
    .ilike('email', targetEmail)
    .eq('status','active').gt('expires_at',now)
    .order('id',{ascending:false}).limit(1).maybeSingle();
  if (rErr) throw rErr;

  // Not in the rental pool right now => preserve the legacy iCloud OTP flow.
  if (!rental) return { enforced:false };

  if (!auth.user || String(rental.user_id) !== String(auth.user.id)) {
    const err=new Error('RENTAL_NOT_OWNER'); err.status=403; throw err;
  }
  if (requestedRentalId && Number(requestedRentalId)!==Number(rental.id)) {
    const err=new Error('INVALID_RENTAL'); err.status=403; throw err;
  }

  const service=normalize(requestedService);
  if (!['facebook','shopee','tiktok'].includes(service)) {
    const err=new Error('SERVICE_REQUIRED'); err.status=403; throw err;
  }

  const {data:ent,error:sErr}=await supabaseAdmin.from('mail_rental_services')
    .select('service,started_at,expires_at,status')
    .eq('rental_id',rental.id).eq('service',service)
    .eq('status','active').gt('expires_at',now).maybeSingle();
  if(sErr) throw sErr;
  if(!ent){ const err=new Error('SERVICE_NOT_RENTED'); err.status=403; throw err; }

  return {enforced:true,rental,service,startedAt:ent.started_at,expiresAt:ent.expires_at};
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

async function searchMailbox(client, mailboxName, targetEmail, options = {}) {
  const providerFilter = normalize(options.provider);
  const minDateMs = options.minDate ? new Date(options.minDate).getTime() : 0;
  const allowDelivery = options.allowDelivery !== false;
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
      if (providerFilter && provider !== providerFilter) continue;

      const msgDate = parsed.date || message.internalDate || null;
      if (minDateMs && (!msgDate || new Date(msgDate).getTime() < minDateMs)) continue;

      const plainText = String(parsed.text || '');
      const htmlText = htmlToText(parsed.html);
      const bodyText = [parsed.subject || '', plainText, htmlText].join('\n');
      const otp = extractOtp(bodyText, provider);
      const anchors = extractAnchors(parsed.html || '');
      const links = pickVerificationLinks({ anchors });
      const delivery = provider === 'shopee'
        ? extractShopeeDeliverySuccess(bodyText, parsed.subject || '')
        : null;

      // Normal marketing/account email is ignored. Shopee delivery-success mail is a valid result
      // even when it contains neither OTP nor a “TẠI ĐÂY” verification link.
      if (!otp && !links.length && !(allowDelivery && delivery)) continue;

      return {
        mailbox: mailboxName,
        uid: message.uid,
        provider,
        from: parsed.from?.value?.[0]?.address || null,
        from_name: parsed.from?.value?.[0]?.name || null,
        to: recipients,
        subject: parsed.subject || null,
        date: msgDate,
        otp,
        links,
        event_type: delivery ? 'delivery_success' : null,
        delivery,
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

  let rentalAccess;
  try {
    rentalAccess = await resolveRentalAccess(
      auth,
      targetEmail,
      req.query?.service,
      req.query?.rental_id
    );
  } catch (accessError) {
    if (supabaseAdmin && auth.user) {
      try { await supabaseAdmin.from('mail_rental_access_log').insert({
        user_id:auth.user.id,email:targetEmail,service:normalize(req.query?.service),
        action:'otp',allowed:false,reason:accessError.message
      }); } catch (_) {}
    }
    return res.status(accessError.status || 403).json({
      ok:false,error:accessError.message,
      message: accessError.message==='SERVICE_NOT_RENTED'
        ? 'Bạn chưa thuê dịch vụ này cho mail hiện tại.'
        : accessError.message==='SERVICE_REQUIRED'
        ? 'Mail đang được thuê. Hãy chọn đúng dịch vụ đã thuê.'
        : accessError.message==='RENTAL_NOT_OWNER'
        ? 'Mail này đang thuộc phiên thuê của người dùng khác.'
        : accessError.message
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
        const mail = await searchMailbox(client, mailbox, targetEmail, rentalAccess?.enforced ? {
          provider:rentalAccess.service,
          minDate:rentalAccess.startedAt,
          allowDelivery:false
        } : {});
        if (mail) found.push(mail);
      } catch (error) {
        console.error('MAILBOX_ERROR:', mailbox, error?.message || error);
      }
    }

    if (!found.length) {
      return res.status(404).json({
        ok: false,
        error: 'MAIL_NOT_FOUND',
        message: rentalAccess?.enforced
          ? `Chưa tìm thấy OTP/link ${rentalAccess.service} mới trong thời gian thuê.`
          : 'Chưa tìm thấy thư Facebook, Shopee hoặc TikTok mới cho email này.',
        email: targetEmail,
        searched: mailboxes,
      });
    }

    found.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const newest = found[0];

    if (rentalAccess?.enforced && supabaseAdmin && auth.user) {
      try { await supabaseAdmin.from('mail_rental_access_log').insert({
        user_id:auth.user.id,rental_id:rentalAccess.rental.id,email:targetEmail,
        service:rentalAccess.service,action:'otp',allowed:true,reason:'OK'
      }); } catch (_) {}
    }

    return res.status(200).json({
      ok: true,
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
