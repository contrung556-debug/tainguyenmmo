// ============================================================
// NK MMO Store V28.8.6 - Mail Rental API + Wallet Billing
// GET  /api/mail-rental?action=plans
// GET  /api/mail-rental?action=my
// POST /api/mail-rental  {action:'rent', service:'shopee', days:7}
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function clients() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) {
    throw new Error('MISSING_SUPABASE_ENV');
  }
  return {
    auth: createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    }),
    admin: createClient(SUPABASE_URL, SERVICE_KEY, {
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    })
  };
}

async function getUser(req, auth) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const { data, error } = await auth.auth.getUser(m[1].trim());
  if (error || !data?.user) return null;
  return data.user;
}

function cleanService(v){
  const s=String(v||'').trim().toLowerCase();
  return ['shopee','facebook','tiktok'].includes(s)?s:'';
}
function cleanDays(v){
  const n=Number(v); return [7,30,180].includes(n)?n:0;
}

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  try{
    const {auth,admin}=clients();
    const action=String(req.method==='GET'?req.query?.action:req.body?.action||'').trim().toLowerCase();

    if(req.method==='GET' && action==='plans'){
      const {data,error}=await admin.from('mail_rental_plans')
        .select('service,days,price_vnd,enabled')
        .eq('enabled',true).order('service').order('days');
      if(error) throw error;
      return res.status(200).json({ok:true,plans:data||[]});
    }

    const user=await getUser(req,auth);
    if(!user) return res.status(401).json({ok:false,error:'UNAUTHORIZED'});

    try { await admin.rpc('nk_expire_mail_rentals'); } catch (_) {}

    if(req.method==='GET' && action==='my'){
      const {data:rental,error:rErr}=await admin.from('mail_rentals')
        .select('id,email,status,started_at,expires_at,created_at')
        .eq('user_id',user.id).eq('status','active').gt('expires_at',new Date().toISOString())
        .order('id',{ascending:false}).limit(1).maybeSingle();
      if(rErr) throw rErr;
      if(!rental) return res.status(200).json({ok:true,rental:null,services:[]});
      const {data:services,error:sErr}=await admin.from('mail_rental_services')
        .select('service,status,started_at,expires_at')
        .eq('rental_id',rental.id).eq('status','active').gt('expires_at',new Date().toISOString())
        .order('service');
      if(sErr) throw sErr;
      return res.status(200).json({ok:true,rental,services:services||[]});
    }

    if(req.method==='POST' && action==='rent'){
      const service=cleanService(req.body?.service);
      const days=cleanDays(req.body?.days);
      if(!service) return res.status(400).json({ok:false,error:'INVALID_SERVICE'});
      if(!days) return res.status(400).json({ok:false,error:'INVALID_DAYS'});

      const requestId=String(req.body?.request_id||'').trim() || randomUUID();
      const {data,error}=await admin.rpc('nk_rent_icloud_service_paid',{
        p_user_id:user.id,p_service:service,p_days:days,p_request_id:requestId
      });
      if(error){
        const msg=String(error.message||'');
        if(msg.includes('OUT_OF_MAIL_STOCK')) return res.status(409).json({ok:false,error:'OUT_OF_MAIL_STOCK',message:'Kho iCloud hiện đã hết mail trống.'});
        if(msg.includes('PLAN_DISABLED')) return res.status(409).json({ok:false,error:'PLAN_DISABLED',message:'Gói thuê này hiện không khả dụng.'});
        if(msg.includes('REQUEST_ID_CONFLICT')) return res.status(409).json({ok:false,error:'REQUEST_ID_CONFLICT',message:'Mã giao dịch không hợp lệ.'});
        throw error;
      }
      if(!data?.success){
        const code=String(data?.error||'RENTAL_FAILED');
        const status=code==='INSUFFICIENT_BALANCE'?402:(code==='PLAN_PRICE_NOT_CONFIGURED'||code==='PLAN_DISABLED'?409:400);
        return res.status(status).json({ok:false,...data});
      }
      return res.status(200).json({ok:true,rental:data,billing:{charged:!!data.charged,duplicate:!!data.duplicate,price_vnd:Number(data.price_vnd||0),balance:Number(data.balance||0),request_id:data.request_id||requestId}});
    }

    return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  }catch(e){
    console.error('MAIL_RENTAL_API_ERROR',e);
    return res.status(500).json({ok:false,error:'SERVER_ERROR',message:e?.message||'Lỗi máy chủ'});
  }
};
