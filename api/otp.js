// NK MMO Store: guarded public OTP endpoint.
// Public lookup must not expose an active iCloud rental's messages.
// Rental owners use /api/mail with authenticated rental_id and service.
const { createClient } = require('@supabase/supabase-js');
const UPSTREAM = 'https://script.google.com/macros/s/AKfycbwk0RSNFUrzaU7nSlNgAgazt3BWUNR-meYBYvJcSkJIFxQe4XiDfGd3FsfcSTWzOLk/exec';
const URL = process.env.SUPABASE_URL || 'https://hsdbjzkxbdezysxwwtaw.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const admin = KEY ? createClient(URL, KEY, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} }) : null;

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private, max-age=0');
  if(req.method!=='GET') return res.status(405).json({status:'error',error:'METHOD_NOT_ALLOWED'});
  const input = String(req.query?.hide || '').trim().toLowerCase();
  // Reject ambiguous aliases: otherwise a bare username could bypass the rental lookup.
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) || input.length>254)
    return res.status(400).json({status:'error',error:'FULL_EMAIL_REQUIRED',message:'Hãy nhập địa chỉ email đầy đủ.'});

  if(input.endsWith('@icloud.com')) {
    if(!admin) return res.status(503).json({status:'error',error:'RENTAL_CHECK_UNAVAILABLE'});
    try {
      const {data,error} = await admin.from('mail_rentals')
        .select('id').eq('email',input).eq('status','active')
        .gt('expires_at',new Date().toISOString()).limit(1);
      if(error) throw error;
      if(data?.length) return res.status(403).json({
        status:'error',error:'RENTAL_OTP_PROTECTED',
        message:'Email này đang được thuê. Vào Thuê Mail, chọn đúng đơn và dịch vụ để lấy OTP.'
      });
    } catch(err) {
      console.error('OTP_RENTAL_GATE_ERROR',err?.message || err);
      return res.status(503).json({status:'error',error:'RENTAL_CHECK_UNAVAILABLE'});
    }
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
