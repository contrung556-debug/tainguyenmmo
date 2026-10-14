// NK MMO Store V28.6.2 - Cookie session guard + atomic cooldown + safer refresh
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
function env(n){const v=String(process.env[n]||'').trim();if(!v)throw new Error('Thiếu biến môi trường '+n);return v;}
function admin(){return createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});}
function cookieHeader(v){v=String(v||'').trim();return v.includes('=')?v:'SPC_ST='+v;}
function key(){return crypto.createHash('sha256').update(env('SESSION_ENCRYPTION_KEY')).digest();}
function enc(t){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv),b=Buffer.concat([c.update(String(t),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64');}
function dec(x){const b=Buffer.from(x,'base64'),iv=b.subarray(0,12),tag=b.subarray(12,28),body=b.subarray(28),d=crypto.createDecipheriv('aes-256-gcm',key(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]).toString('utf8');}
async function userFromReq(req,sb){const h=String(req.headers.authorization||'');if(!h.startsWith('Bearer '))throw new UserError('Bạn chưa đăng nhập',401,'UNAUTHORIZED');const {data,error}=await sb.auth.getUser(h.slice(7));if(error||!data?.user)throw new UserError('Phiên đăng nhập không hợp lệ',401,'UNAUTHORIZED');return data.user;}
async function cleanupExpired(sb){const {error}=await sb.from('shopee_cookie_sessions').delete().lte('expires_at',new Date().toISOString());if(error)console.warn('cookie cleanup:',error.message);}
async function vubel(path,cookie,proxy){
  const dispatcher=new ProxyAgent(proxy);
  try{
    const r=await undiciRequest(VUBEL_BASE+path,{method:'POST',dispatcher,signal:AbortSignal.timeout(VUBEL_TIMEOUT_MS),headersTimeout:VUBEL_TIMEOUT_MS,bodyTimeout:VUBEL_TIMEOUT_MS,headers:{'x-api-key':env('VUBEL_API_KEY'),'Cookie':cookie,'Content-Type':'application/json'},body:JSON.stringify({proxy})});
    const text=await r.body.text();let data;try{data=JSON.parse(text)}catch(_){data={raw:text}}
    if(r.statusCode<200||r.statusCode>=300){const msg=clean(data?.message||data?.title)||('HTTP '+r.statusCode);const authBad=r.statusCode===401||r.statusCode===403||(r.statusCode<500&&/cookie\s*(invalid|expired|không hợp lệ|hết hạn)|invalid\s*cookie|not\s*logged\s*in|chưa đăng nhập|đăng nhập lại/i.test(msg));throw new UserError('Vubel: '+msg,authBad?401:502,authBad?'COOKIE_INVALID':'VUBEL_ERROR');}
    return data;
  }catch(e){
    if(e instanceof UserError)throw e;
    if(isTimeout(e))throw new UserError('Vubel phản hồi quá chậm, vui lòng thử lại sau.',504,'VUBEL_TIMEOUT');
    console.error('vubel request:',path,e);
    throw new UserError('Không kết nối được tới Vubel/proxy, vui lòng thử lại.',502,'VUBEL_UNREACHABLE');
  }finally{try{await dispatcher.close()}catch(_){}}
}
function inner(d){return d?.data?.data||d?.data||d||{};}
function ordersFrom(d){const x=inner(d);if(Array.isArray(x?.orders))return x.orders;if(Array.isArray(x?.order_list))return x.order_list;if(Array.isArray(x?.list))return x.list;if(Array.isArray(x))return x;return [];}
function first(o,paths,def=null){for(const p of paths){let v=o;for(const k of p.split('.'))v=v?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return def;}
function tracking(o){const ships=o?.shipping?.shipments||o?.shipments||[];return first(o,['shipping.trackingNumber','shipping.tracking_number','trackingNumber','tracking_number','tracking_no','tracking_code'])||first(ships?.[0]||{},['trackingNumber','tracking_number','trackingNo','tracking_no']);}
function carrier(o){const ships=o?.shipping?.shipments||o?.shipments||[];return String(first(o,['shipping.carrier','carrier'])||first(ships?.[0]||{},['carrier','carrierName','logisticsName'])||'');}
function itemName(o){const items=Array.isArray(o?.items)?o.items:[];const names=items.map(x=>first(x,['name','itemName','productName','title'],'')).filter(Boolean);return names.join(' • ')||'Đơn Shopee';}
function amount(o){const n=Number(first(o,['payment.amountPaid','payment.total','payment.subtotal','total_amount','amount','price'],0));return Number.isFinite(n)?Math.round(n):0;}
function normalize(o){
  const sn=first(o,['orderSn','order_sn','ordersn','orderId','order_id','id']); if(!sn)return null;
  const recipient=o?.recipient||{}; const tr=tracking(o); const st=String(first(o,['statusLabel','status_label','status'],'Đang chờ giao'));
  return {sn:String(sn),orderId:first(o,['orderId','order_id']),tracking:tr?String(tr).trim().toUpperCase():null,carrier:carrier(o),product:itemName(o),amount:amount(o),status:st,
    recipient_name:String(first(recipient,['name'],'')||first(o,['recipient_name'],'')||''),recipient_phone:String(first(recipient,['phone'],'')||first(o,['recipient_phone'],'')||'').replace(/[^\d+]/g,''),recipient_address:String(first(recipient,['address'],'')||first(o,['shipping_address'],'')||''),raw:o};
}
async function saveOrders(sb,userId,rawOrders,accountInfo){
  const byCode=new Map();for(const o of rawOrders){const x=normalize(o);if(x)byCode.set(x.sn,x);}
  const list=[...byCode.values()];
  if(!list.length)return {total:0,inserted:0,updated:0,new_tracking:0,pending:0};
  const prevMap=new Map();
  for(const part of chunks(list.map(x=>x.sn),200)){
    const {data,error}=await sb.from('shopee_orders').select('id,order_code,tracking_number,source,product_name,amount,price,recipient_name,recipient_phone,shipping_address').eq('user_id',userId).in('order_code',part);if(error)throw error;
    for(const r of data||[])prevMap.set(String(r.order_code),r);
  }
  let inserted=0,updated=0,newTracking=0,pending=0;const now=new Date().toISOString();
  const payloads=list.map(x=>{
    const prev=prevMap.get(x.sn);
    const keep=!!prev&&!!prev.source&&prev.source!=='cookie';
    const trk=x.tracking||prev?.tracking_number||null, resolved=!!trk;
    if(!resolved)pending++;if(x.tracking&&!prev?.tracking_number)newTracking++;if(prev)updated++;else inserted++;
    const o=x.raw;
    return {user_id:userId,order_code:x.sn,shopee_order_sn:x.sn,product_name:keep?(prev.product_name||x.product):x.product,amount:keep?(prev.amount||x.amount):x.amount,price:keep?(prev.price||x.amount):x.amount,status:x.status||'Đang chờ giao',source:keep?prev.source:'cookie',recipient_name:keep?(prev.recipient_name||x.recipient_name):x.recipient_name,recipient_phone:keep?(prev.recipient_phone||x.recipient_phone):x.recipient_phone,shipping_address:keep?(prev.shipping_address||x.recipient_address):x.recipient_address,tracking_number:trk,tracking_status:resolved?'found':'waiting',vubel_tracking_resolved:resolved,last_synced_at:now,status_key:first(o,['statusKey','status_key']),status_label:first(o,['statusLabel','status_label']),recipient_json:o?.recipient||{},shops_json:o?.shops||[],parcels_json:o?.parcels||[],items_json:o?.items||[],payment_json:o?.payment||{},shipping_json:o?.shipping||{},processing_json:o?.processing||{},coins_json:o?.coins||{},vubel_account_json:accountInfo||{},vubel_raw:o};
  });
  const idByCode=new Map();
  for(const part of chunks(payloads,CHUNK)){
    const {data,error}=await sb.from('shopee_orders').upsert(part,{onConflict:'user_id,order_code'}).select('id,order_code');if(error)throw error;
    for(const r of data||[])idByCode.set(String(r.order_code),r.id);
  }
  const trackRows=list.filter(x=>x.tracking&&idByCode.has(x.sn)).map(x=>({order_id:Number(idByCode.get(x.sn)),user_id:userId,tracking_code:x.tracking,tracking_status:x.status||'Đã có mã vận đơn',updated_at:now}));
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
    if(action!=='import'&&action!=='sync'&&action!=='refresh')throw new UserError('Action không hợp lệ',400,'BAD_ACTION');

    // V28.6.2: đọc session TRƯỚC khi dọn cookie hết hạn để báo đúng lý do.
    let cur=null;
    {
      const {data,error}=await sb.from('shopee_cookie_sessions').select('cookie_enc,expires_at,active,last_sync_at').eq('user_id',user.id).maybeSingle();
      if(error)throw error;
      cur=data||null;
      await cleanupExpired(sb);
    }
    if(action==='sync'||action==='refresh'){
      if(!cur)throw new UserError('Chưa có Cookie Shopee (hoặc Cookie đã hết hạn và bị xóa). Vui lòng nhập Cookie mới.',400,'NO_COOKIE');
      const exp=cur.expires_at?new Date(cur.expires_at).getTime():0;
      if(!cur.cookie_enc||!exp||exp<=nowMs)throw new UserError('Cookie Shopee đã hết hạn (quá 7 ngày). Vui lòng nhập Cookie mới.',400,'COOKIE_EXPIRED');
      if(!cur.active)throw new UserError('Cookie Shopee không còn hiệu lực. Vui lòng nhập Cookie mới.',400,'COOKIE_INVALID');
    }

    // sync = chỉ tìm mã vận đơn còn thiếu. Đã resolve hết thì KHÔNG gọi HomeProxy/Vubel.
    // refresh = chủ động lấy lại FULL thông tin đơn, kể cả đơn đã có tracking.
    if(action==='sync'){
      const {count:pendingCount,error:pe}=await sb.from('shopee_orders')
        .select('id',{count:'exact',head:true})
        .eq('user_id',user.id)
        .eq('source','cookie')
        .eq('vubel_tracking_resolved',false);
      if(pe)throw pe;
      if((pendingCount||0)===0){
        return res.status(200).json({ok:true,skipped:true,reason:'NO_PENDING_VUBEL_TRACKING',message:'Không còn đơn Cookie chờ lấy mã vận đơn. Dùng “Làm mới full đơn” khi cần cập nhật lại toàn bộ dữ liệu.',total:0,inserted:0,updated:0,new_tracking:0,pending:0});
      }
    }

    const nowIso=new Date(nowMs).toISOString();
    const prevSync=cur?.last_sync_at||null;
    let claimed=false;
    // V28.6.2: claim cooldown nguyên tử (chống 2 request song song cùng qua kiểm tra).
    if(cur){
      const cutoff=new Date(nowMs-COOLDOWN_MS).toISOString();
      const {data:c,error:ce}=await sb.from('shopee_cookie_sessions').update({last_sync_at:nowIso}).eq('user_id',user.id).or('last_sync_at.is.null,last_sync_at.lt.'+cutoff).select('user_id');
      if(ce)throw ce;
      if(!c||!c.length){
        const wait=prevSync?COOLDOWN_MS-(nowMs-new Date(prevSync).getTime()):COOLDOWN_MS;
        throw new UserError('Vui lòng đợi '+Math.max(1,Math.ceil(wait/1000))+' giây rồi đồng bộ lại.',429,'COOLDOWN');
      }
      claimed=true;
    }
    try{
    let cookie;let importSession=null;
    if(action==='import'){
      if(!String(req.body?.cookie||'').trim())throw new UserError('Cookie Shopee đang trống',400,'EMPTY_COOKIE');
      cookie=cookieHeader(req.body.cookie);
      // Chỉ lưu/active Cookie SAU KHI Vubel xác nhận request đơn thành công.
      importSession={user_id:user.id,cookie_enc:enc(cookie),active:true,expires_at:new Date(nowMs+COOKIE_TTL_MS).toISOString(),updated_at:nowIso,last_sync_at:nowIso};
    }else{
      try{cookie=dec(cur.cookie_enc);}
      catch(de){
        console.error('cookie decrypt:',de?.message||de);
        await sb.from('shopee_cookie_sessions').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',user.id);
        throw new UserError('Không giải mã được Cookie đã lưu. Vui lòng nhập Cookie mới.',400,'COOKIE_INVALID');
      }
    }

    let hp;try{hp=await getSharedHomeProxy();}catch(e){console.error('homeproxy:',e);throw new UserError('Không lấy được proxy, vui lòng thử lại sau ít phút.',502,'PROXY_ERROR');}
    const [infoR,ordersR]=await Promise.allSettled([vubel('/v1/shopee/info',cookie,hp.proxy),vubel('/v1/shopee/get_order',cookie,hp.proxy)]);
    if(ordersR.status==='rejected'){
      const err=ordersR.reason;
      if((action==='sync'||action==='refresh')&&isCookieInvalid(err))await sb.from('shopee_cookie_sessions').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',user.id);
      throw err;
    }
    if(infoR.status==='rejected')console.warn('vubel info failed:',infoR.reason?.message);
    const account=infoR.status==='fulfilled'?inner(infoR.value):{};
    const result=await saveOrders(sb,user.id,ordersFrom(ordersR.value),account);
    // V28.6.1: chỉ ghi cooldown sau khi Vubel + lưu đơn thành công (sync/refresh).
    // Import mới cũng chỉ được lưu/active sau khi toàn bộ quá trình import thành công.
    if(action==='import'){
      const {error:ce}=await sb.from('shopee_cookie_sessions').upsert(importSession,{onConflict:'user_id'});if(ce)throw ce;
    }else{
      const {error:ue}=await sb.from('shopee_cookie_sessions').update({last_sync_at:nowIso,updated_at:nowIso}).eq('user_id',user.id);if(ue)throw ue;
    }
    return res.status(200).json({ok:true,...result,account:{userid:first(account,['userid','userId']),username:first(account,['username','nickname']),email:first(account,['email'])},proxy:{provider:hp.provider,location:hp.location,reused:hp.reused,age_ms:hp.age_ms}});
    }catch(inner){
      // Lỗi sau khi claim: hoàn lại cooldown (chỉ khi chưa ai ghi đè).
      if(claimed)await sb.from('shopee_cookie_sessions').update({last_sync_at:prevSync}).eq('user_id',user.id).eq('last_sync_at',nowIso).then(()=>{},()=>{});
      throw inner;
    }
  }catch(e){
    console.error('shopee-cookie-orders:',e);
    if(e instanceof UserError)return res.status(e.status).json({ok:false,error:e.code,message:e.message});
    return res.status(500).json({ok:false,error:'SYNC_FAILED',message:'Đồng bộ thất bại, vui lòng thử lại sau ít phút.'});
  }
};
