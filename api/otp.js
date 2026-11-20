// NK MMO Store: public OTP endpoint (no login).
// Any email that has EVER been rented is blocked here permanently; use the rental page instead.
const { createClient } = require('@supabase/supabase-js');
const UPSTREAM = 'https://script.google.com/macros/s/AKfycbwk0RSNFUrzaU7nSlNgAgazt3BWUNR-meYBYvJcSkJIFxQe4XiDfGd3FsfcSTWzOLk/exec';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hsdbjzkxbdezysxwwtaw.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const admin = KEY ? createClient(SUPABASE_URL, KEY, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} }) : null;

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, private, max-age=0');
  if(req.method!=='GET') return res.status(405).json({status:'error',error:'METHOD_NOT_ALLOWED'});
  const input = String(req.query?.hide || '').trim().toLowerCase();
  if(!input || input.length>254)
    return res.status(400).json({status:'error',error:'EMAIL_REQUIRED',message:'Hãy nhập email.'});

  // Block every email that appears in rental history (active, expired or returned).
  if (!admin) {
    console.error('OTP_MISSING_SUPABASE_SERVICE_ROLE_KEY');
    return res.status(503).json({status:'error',error:'OTP_RENTAL_CHECK_FAILED'});
  }
  try {
    const { data, error } = await admin
      .from('mail_rentals')
      .select('id')
      .eq('email', input)
      .limit(1);
    if (error) throw error;
    if (data?.length) {
      return res.status(403).json({
        status: 'error', error: 'RENTAL_EMAIL',
        message: 'Email này là mail thuê, không lấy OTP tại đây. Hãy lấy ở trang thuê mail.'
      });
    }
  } catch (err) {
    console.error('OTP_RENTAL_CHECK_ERROR', err?.message || err);
    return res.status(503).json({status:'error',error:'OTP_RENTAL_CHECK_FAILED'});
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
