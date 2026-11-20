// NK MMO Store: guarded public OTP endpoint.
// Public lookup must not expose an active iCloud rental's messages.
// Rental owners use /api/mail with authenticated rental_id and service.
const { createClient } = require('@supabase/supabase-js');
const UPSTREAM = 'https://script.google.com/macros/s/AKfycbwk0RSNFUrzaU7nSlNgAgazt3BWUNR-meYBYvJcSkJIFxQe4XiDfGd3FsfcSTWzOLk/exec';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hsdbjzkxbdezysxwwtaw.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const admin = KEY ? createClient(SUPABASE_URL, KEY, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} }) : null;

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private, max-age=0');
  if(req.method!=='GET') return res.status(405).json({status:'error',error:'METHOD_NOT_ALLOWED'});
  const input = String(req.query?.hide || '').trim().toLowerCase();
  // Reject ambiguous aliases: otherwise a bare username could bypass the rental lookup.
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) || input.length>254)
    return res.status(400).json({status:'error',error:'FULL_EMAIL_REQUIRED',message:'Hãy nhập địa chỉ email đầy đủ.'});

  // iCloud OTP must only be read through the authenticated IMAP API.
  // Never route iCloud addresses through the public legacy Apps Script.
  if (input.endsWith('@icloud.com')) {
    return res.status(403).json({
      status: 'error', error: 'ICLOUD_IMAP_REQUIRED',
      message: 'Hãy đăng nhập và dùng chức năng IMAP iCloud được cấp quyền hoặc đơn thuê hợp lệ.'
    });
  }

  try {
    const u=new URL(UPSTREAM);
    u.searchParams.set('hide',input);
    const response=await fetch(u,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(25000),redirect:'follow'});
    const body=await response.text();
    if(body.length>1000000) return res.status(502).json({status:'error',error:'OTP_UPSTREAM_OVERSIZE'});
    res.status(response.ok?200:502).setHeader('Content-Type','application/json; charset=utf-8');
    try { return res.send(JSON.stringify(JSON.parse(body))); }
    catch(_) { return res.status(502).json({status:'error',error:'OTP_UPSTREAM_INVALID'}); }
  } catch(err) {
    console.error('OTP_UPSTREAM_ERROR',err?.message||err);
    return res.status(502).json({status:'error',error:'OTP_UPSTREAM_UNAVAILABLE'});
  }
};
