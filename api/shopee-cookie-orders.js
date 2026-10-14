// NK MMO Store V28.6.6 - Cookie session guard + atomic cooldown + safer refresh
const { createClient } = require('@supabase/supabase-js');
const { ProxyAgent, request: undiciRequest } = require('undici');
const crypto = require('crypto');
const { getSharedHomeProxy } = require('./_lib/homeproxy-shared');
const VUBEL_BASE='https://api.vubel.store';
const VUBEL_TIMEOUT_MS=30000, COOLDOWN_MS=20000, COOKIE_TTL_MS=7*86400000, CHUNK=100;
class UserError extends Error{constructor(message,status=400,code='REQUEST_FAILED'){super(message);this.status=status;this.code=code;}}
const clean=m=>String(m||'').replace(/https?:\/\/\S+/gi,'[url]').slice(0,200);
const isTimeout=e=>['TimeoutError','AbortError','HeadersTimeoutError','BodyTimeoutError','ConnectTimeoutError'].includes(e?.name)||['UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_CONNECT_TIMEOUT'].includes(e?.code);
const isCookieInvalid=e=>e?.code==='COOKIE_INVALID';
const chunks=(a,n)=>{const r=[];for(let i=0;i<a.length;i+=n)r.push(a.slice(i,i+n));return r;};
function env(n){const v=String(process.env[n]||'').trim();if(!v)throw new Error('Thiáº¿u biáº¿n mÃ´i trÆ°á»ng '+n);return v;}
function admin(){return createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});}
function cookieHeader(v){v=String(v||'').trim();return v.includes('=')?v:'SPC_ST='+v;}
function key(){return crypto.createHash('sha256').update(env('SESSION_ENCRYPTION_KEY')).digest();}
function enc(t){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv),b=Buffer.concat([c.update(String(t),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64');}
function dec(x){const b=Buffer.from(x,'base64'),iv=b.subarray(0,12),tag=b.subarray(12,28),body=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',key(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]).toString('utf8');}
async function userFromReq(req,sb){const h=String(req.headers.authorization||'');if(!h.startsWith('Bearer '))throw new UserError('Báº¡n chÆ°a ÄÄng nháº­p',401,'UNAUTHORIZED');const {data,error}=await sb.auth.getUser(h.slice(7));if(error||!data?.user)throw new UserError('PhiÃªn ÄÄng nháº­p khÃ´ng há»£p lá»',401,'UNAUTHORIZED');return data.user;}
async function cleanupExpired(sb){const {error}=await sb.from('shopee_cookie_sessions').delete().lte('expires_at',new Date().toISOString());if(error)console.warn('cookie cleanup:',error.message);}
async function vubel(path,cookie,proxy){
  const dispatcher=new ProxyAgent(proxy);
  try{
    const r=await undiciRequest(VUBEL_BASE+path,{method:'POST',dispatcher,signal:AbortSignal.timeout(VUBEL_TIMEOUT_MS),headersTimeout:VUBEL_TIMEOUT_MS,bodyTimeout:VUBEL_TIMEOUT_MS,headers:{'x-api-key':env('VUBEL_API_KEY'),'Cookie':cookie,'Content-Type':'application/json'},body:JSON.stringify({proxy})});
    const text=await r.body.text();let data;try{data=JSON.parse(text)}catch(_){data={raw:text}}
    if(r.statusCode<200||r.statusCode>=300){const msg=clean(data?.message||data?.title)||('HTTP '+r.statusCode);const authBad=r.statusCode===401||r.statusCode===403||(r.statusCode<500&&/cookie\s*(invalid|expired|khÃ´ng há»£p lá»|háº¿t háº¡n)|invalid\s*cookie|not\s*logged\s*in|chÆ°a ÄÄng nháº­p|ÄÄng nháº­p láº¡i/i.test(msg));throw new UserError('Vubel: '+msg,authBad?401:502,authBad?'COOKIE_INVALID':'VUBEL_ERROR');}
    return data;
  }catch(e){
    if(e instanceof UserError)throw e;
    if(isTimeout(e))throw new UserError('Vubel pháº£n há»i quÃ¡ cháº­m, vui lÃ²ng thá»­ láº¡i sau.',504,'VUBEL_TIMEOUT');
    console.error('vubel request:',path,e);
    throw new UserError('KhÃ´ng káº¿t ná»i ÄÆ°á»£c tá»i Vubel/proxy, vui lÃ²ng thá»­ láº¡i.',502,'VUBEL_UNREACHABLE');
  }finally{try{await dispatcher.close()}catch(_){}}
}
function inner(d){return d?.data?.data||d?.data||d||{};}
function ordersFrom(d){const x=inner(d);if(Array.isArray(x?.orders))return x.orders;if(Array.isArray(x?.order_list))return x.order_list;if(Array.isArray(x?.list))return x.list;if(Array.isArray(x))return x;return [];}
function first(o,paths,def=null){for(const p of paths){let v=o;for(const k of p.split('.'))v=v?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return def;}
function tracking(o){const ships=o?.shipping?.shipments||o?.shipments||[];return first(o,['shipping.trackingNumber','shipping.tracking_number','trackingNumber','tracking_number','tracking_no','tracking_code'])||first(ships?.[0]||{},['trackingNumber','tracking_number','trackingNo','tracking_no']);}
function carrier(o){const ships=o?.shipping?.shipments||o?.shipments||[];return String(first(o,['shipping.carrier','carrier'])||first(ships?.[0]||{},['carrier','carrierName','logisticsName'])||'');}
function itemName(o){
  const pools=[o?.items,o?.item_list,o?.order_items,o?.products,
    (Array.isArray(o?.parcels)?o.parcels.flatMap(p=>p?.items||p?.item_list||[]):[])
  ].filter(Array.isArray);
  const names=pools.flat().map(x=>first(x,['name','itemName','item_name','productName','product_name','title','model.name','model_name','item.name','product.name'],'')).filter(Boolean);
  return [...new Set(names.map(String))].join(' â¢ ')||String(first(o,['product_name','productName','item_name','itemName'],'')||'ÄÆ¡n Shopee');
}
function amount(o){const n=Number(first(o,['payment.amountPaid','payment.total','payment.subtotal','total_amount','amount','price'],0));return Number.isFinite(n)?Math.round(n):0;}
function normalize(o){
  const sn=first(o,['orderSn','order_sn','ordersn','orderId','order_id','id']); if(!sn)return null;
  const recipient=o?.recipient||o?.recipient_address||o?.shipping?.recipient||o?.shipping?.address||{};
  const tr=tracking(o);
  // V28.6.6: giá»¯ nguyÃªn chá»¯ tráº¡ng thÃ¡i Vubel tráº£ vá»; khÃ´ng suy tráº¡ng thÃ¡i tá»« tracking.
  const st=String(first(o,['statusLabel','status_label','processing.statusLabel','processing.status_label','status'],'Äang chá» giao'));
  const addrParts=[
    first(recipient,['address','fullAddress','full_address','address_detail','detail']),
    first(recipient,['ward','ward_name']),
    first(recipient,['district','district_name']),
    first(recipient,['city','city_name','province','province_name'])
  ].filter(Boolean).map(String);
  const addr=[...new Set(addrParts)].join(', ');
  return {sn:String(sn),orderId:first(o,['orderId','order_id']),tracking:tr?String(tr).trim().toUpperCase():null,
    carrier:carrier(o),product:itemName(o),amount:amount(o),status:st,
    recipient_name:String(first(recipient,['name','fullName','full_name','recipient_name'],'')||first(o,['recipient_name','buyer_name'],'')||''),
    recipient_phone:String(first(recipient,['phone','phoneNumber','phone_number','mobile'],'')||first(o,['recipient_phone'],'')||'').replace(/[^\d+]/g,''),
    recipient_address:String(addr||first(o,['shipping_address','recipient_address','address'],'')||''),raw:o};
}
async function saveOrders(sb,userId,rawOrders,accountInfo){
  const byCode=new Map();for(const o of rawOrders){const x=normalize(o);if(x)byCode.set(x.sn,x);}
  const list=[...byCode.values()];
  if(!list.length)return {total:0,inserted:0,updated:0,new_tracking:0,pending:0};
  const prevMap=new Map();
  for(const part of chunks(list.map(x=>x.sn),200)){
    const {data,error}=await sb.from('shopee_orders').select('id,order_code,tracking_number,source,product_name,email,amount,price,recipient_name,recipient_phone,shipping_address').eq('user_id',userId).in('order_code',part);if(error)throw error;
    for(const r of data||[])prevMap.set(String(r.order_code),r);
  }
  let inserted=0,updated=0,newTracking=0,pending=0;const now=new Date().toISOString();
  const payloads=list.map(x=>{
    const prev=prevMap.get(x.sn);
    const keep=!!prev&&!!prev.source&&prev.source!=='cookie';
    const trk=x.tracking||prev?.tracking_number||null, resolved=!!trk;
    if(!resolved)pending++;if(x.tracking&&!prev?.tracking_number)newTracking++;if(prev)updated++;else inserted++;
    const o=x.raw;
    const accountEmail=String(first(accountInfo||{},['email','email_address','emailAddress'],'')||'').trim();
    return {user_id:userId,order_code:x.sn,shopee_order_sn:x.sn,product_name:keep?(prev.product_name||x.product):x.product,email:keep?(prev.email||accountEmail):(accountEmail||null),amount:keep?(prev.amount||x.amount):x.amount,price:keep?(prev.price||x.amount):x.amount,status:x.status||'Äang chá» giao',source:keep?prev.source:'cookie',recipient_name:keep?(prev.recipient_name||x.recipient_name):x.recipient_name,recipient_phone:keep?(prev.recipient_phone||x.recipient_phone):x.recipient_phone,shipping_address:keep?(prev.shipping_address||x.recipient_address):x.recipient_address,tracking_number:trk,tracking_status:resolved?'found':'waiting',vubel_tracking_resolved:resolved,last_synced_at:now,status_key:first(o,['statusKey','status_key']),status_label:first(o,['statusLabel','status_label','processing.statusLabel','processing.status_label','status']),recipient_json:o?.recipient||{},shops_json:o?.shops||[],parcels_json:o?.parcels||[],items_json:o?.items||[],payment_json:o?.payment||{},shipping_json:o?.shipping||{},processing_json:o?.processing||{},coins_json:o?.coins||{},vubel_account_json:accountInfo||{},vubel_raw:o};
  });
  const idByCode=new Map();
  for(const part of chunks(payloads,CHUNK)){
    const {data,error}=await sb.from('shopee_orders').upsert(part,{onConflict:'user_id,order_code'}).select('id,order_code');if(error)throw error;
    for(const r of data||[])idByCode.set(String(r.order_code),r.id);
  }
  const trackRows=list.filter(x=>x.tracking&&idByCode.has(x.sn)).map(x=>({order_id:Number(idByCode.get(x.sn)),user_id:userId,tracking_code:x.tracking,tracking_status:x.status||'ÄÃ£ cÃ³ mÃ£ váº­n ÄÆ¡n',updated_at:now}));
  let trackingWarning=false;
  try{for(const part of chunks(trackRows,CHUNK)){const {error}=await sb.from('shopee_tracking').upsert(part,{onConflict:'order_id'});if(error)throw error;}}
  catch(te){trackingWarning=true;console.error('shopee_tracking upsert:',te?.message||te);}
  return {total:list.length,inserted,updated,new_tracking:newTracking,pending,tracking_warning:trackingWarning};
}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,message:'Method not allowed'});
  try{
    const sb=admin();const user=await userFromReq(req,sb);
    const action=String(req.body?.action||'import');
    const nowMs=Date.now();

    if(action==='status'){
      const {data:s,error}=await sb.from('shopee_cookie_sessions').select('expires_at,active').eq('user_id',user.id).maybeSingle();if(error)throw error;
      const exp=s?.expires_at?new Date(s.expires_at).getTime():0,has=!!s?.active&&exp>nowMs;
      await cleanupExpired(sb);
      return res.status(200).json({ok:true,has_cookie:has,expires_at:has?s.expires_at:null,remaining_ms:has?exp-nowMs:0});
    }
    if(action==='delete'){
      const {error}=await sb.from('shopee_cookie_sessions').delete().eq('user_id',user.id);if(error)throw error;
      return res.status(200).json({ok:true,deleted:true});
    }
    if(action!=='import'&&action!=='sync'&&action!=='refresh')throw new UserError('Action khÃ´ng há»£p lá»',400,'BAD_ACTION');

    // V28.6.2: Äá»c session TRÆ¯á»C khi dá»n cookie háº¿t háº¡n Äá» bÃ¡o ÄÃºng lÃ½ do.
    let cur=null;
    {
      const {data,error}=await sb.from('shopee_cookie_sessions').select('cookie_enc,expires_at,active,last_sync_at').eq('user_id',user.id).maybeSingle();
      if(error)throw error;
      cur=data||null;
      await cleanupExpired(sb);
    }
    if(action==='sync'||action==='refresh'){
      if(!cur)throw new UserError('ChÆ°a cÃ³ Cookie Shopee (hoáº·c Cookie ÄÃ£ háº¿t háº¡n vÃ  bá» xÃ³a). Vui lÃ²ng nháº­p Cookie má»i.',400,'NO_COOKIE');
      const exp=cur.expires_at?new Date(cur.expires_at).getTime():0;
      if(!cur.cookie_enc||!exp||exp<=nowMs)throw new UserError('Cookie Shopee ÄÃ£ háº¿t háº¡n (quÃ¡ 7 ngÃ y). Vui lÃ²ng nháº­p Cookie má»i.',400,'COOKIE_EXPIRED');
      if(!cur.active)throw new UserError('Cookie Shopee khÃ´ng cÃ²n hiá»u lá»±c. Vui lÃ²ng nháº­p Cookie má»i.',400,'COOKIE_INVALID');
    }

    // sync = chá» tÃ¬m mÃ£ váº­n ÄÆ¡n cÃ²n thiáº¿u. ÄÃ£ resolve háº¿t thÃ¬ KHÃNG gá»i HomeProxy/Vubel.
    // refresh = chá»§ Äá»ng láº¥y láº¡i FULL thÃ´ng tin ÄÆ¡n, ká» cáº£ ÄÆ¡n ÄÃ£ cÃ³ tracking.
    if(action==='sync'){
      const {count:pendingCount,error:pe}=await sb.from('shopee_orders')
        .select('id',{count:'exact',head:true})
        .eq('user_id',user.id)
        .eq('source','cookie')
        .eq('vubel_tracking_resolved',false);
      if(pe)throw pe;
      if((pendingCount||0)===0){
        return res.status(200).json({ok:true,skipped:true,reason:'NO_PENDING_VUBEL_TRACKING',message:'KhÃ´ng cÃ²n ÄÆ¡n Cookie chá» láº¥y mÃ£ váº­n ÄÆ¡n. DÃ¹ng âLÃ m má»i full ÄÆ¡nâ khi cáº§n cáº­p nháº­t láº¡i toÃ n bá» dá»¯ liá»u.',total:0,inserted:0,updated:0,new_tracking:0,pending:0});
      }
    }

    const nowIso=new Date(nowMs).toISOString();
    const prevSync=cur?.last_sync_at||null;
    let claimed=false;
    // V28.6.2: claim cooldown nguyÃªn tá»­ (chá»ng 2 request song song cÃ¹ng qua kiá»m tra).
    if(cur){
      const cutoff=new Date(nowMs-COOLDOWN_MS).toISOString();
      const {data:c,error:ce}=await sb.from('shopee_cookie_sessions').update({last_sync_at:nowIso}).eq('user_id',user.id).or('last_sync_at.is.null,last_sync_at.lt.'+cutoff).select('user_id');
      if(ce)throw ce;
      if(!c||!c.length){
        const wait=prevSync?COOLDOWN_MS-(nowMs-new Date(prevSync).getTime()):COOLDOWN_MS;
        throw new UserError('Vui lÃ²ng Äá»£i '+Math.max(1,Math.ceil(wait/1000))+' giÃ¢y rá»i Äá»ng bá» láº¡i.',429,'COOLDOWN');
      }
      claimed=true;
    }
    try{
    let cookie;let importSession=null;
    if(action==='import'){
      if(!String(req.body?.cookie||'').trim())throw new UserError('Cookie Shopee Äang trá»ng',400,'EMPTY_COOKIE');
      cookie=cookieHeader(req.body.cookie);
      // Chá» lÆ°u/active Cookie SAU KHI Vubel xÃ¡c nháº­n request ÄÆ¡n thÃ nh cÃ´ng.
      importSession={user_id:user.id,cookie_enc:enc(cookie),active:true,expires_at:new Date(nowMs+COOKIE_TTL_MS).toISOString(),updated_at:nowIso,last_sync_at:nowIso};
    }else{
      try{cookie=dec(cur.cookie_enc);}
      catch(de){
        console.error('cookie decrypt:',de?.message||de);
        await sb.from('shopee_cookie_sessions').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',user.id);
        throw new UserError('KhÃ´ng giáº£i mÃ£ ÄÆ°á»£c Cookie ÄÃ£ lÆ°u. Vui lÃ²ng nháº­p Cookie má»i.',400,'COOKIE_INVALID');
      }
    }

    let hp;try{hp=await getSharedHomeProxy();}catch(e){console.error('homeproxy:',e);throw new UserError('KhÃ´ng láº¥y ÄÆ°á»£c proxy, vui lÃ²ng thá»­ láº¡i sau Ã­t phÃºt.',502,'PROXY_ERROR');}
    const [infoR,ordersR]=await Promise.allSettled([vubel('/v1/shopee/info',cookie,hp.proxy),vubel('/v1/shopee/get_order',cookie,hp.proxy)]);
    if(ordersR.status==='rejected'){
      const err=ordersR.reason;
      if((action==='sync'||action==='refresh')&&isCookieInvalid(err))await sb.from('shopee_cookie_sessions').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',user.id);
      throw err;
    }
    if(infoR.status==='rejected')console.warn('vubel info failed:',infoR.reason?.message);
    const account=infoR.status==='fulfilled'?inner(infoR.value):{};
    const result=await saveOrders(sb,user.id,ordersFrom(ordersR.value),account);
    // V28.6.1: chá» ghi cooldown sau khi Vubel + lÆ°u ÄÆ¡n thÃ nh cÃ´ng (sync/refresh).
    // Import má»i cÅ©ng chá» ÄÆ°á»£c lÆ°u/active sau khi toÃ n bá» quÃ¡ trÃ¬nh import thÃ nh cÃ´ng.
    if(action==='import'){
      const {error:ce}=await sb.from('shopee_cookie_sessions').upsert(importSession,{onConflict:'user_id'});if(ce)throw ce;
    }else{
      const {error:ue}=await sb.from('shopee_cookie_sessions').update({last_sync_at:nowIso,updated_at:nowIso}).eq('user_id',user.id);if(ue)throw ue;
    }
    return res.status(200).json({ok:true,...result,account:{userid:first(account,['userid','userId']),username:first(account,['username','nickname']),email:first(account,['email'])},proxy:{provider:hp.provider,location:hp.location,reused:hp.reused,age_ms:hp.age_ms}});
    }catch(inner){
      // Lá»i sau khi claim: hoÃ n láº¡i cooldown (chá» khi chÆ°a ai ghi ÄÃ¨).
      if(claimed)await sb.from('shopee_cookie_sessions').update({last_sync_at:prevSync}).eq('user_id',user.id).eq('last_sync_at',nowIso).then(()=>{},()=>{});
      throw inner;
    }
  }catch(e){
    console.error('shopee-cookie-orders:',e);
    if(e instanceof UserError)return res.status(e.status).json({ok:false,error:e.code,message:e.message});
    return res.status(500).json({ok:false,error:'SYNC_FAILED',message:'Äá»ng bá» tháº¥t báº¡i, vui lÃ²ng thá»­ láº¡i sau Ã­t phÃºt.'});
  }
};
