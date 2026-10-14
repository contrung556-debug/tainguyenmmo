// NK MMO Store V28.7.0 - Multi Cookie Accounts + sequential distinct-proxy tracking sync
const { createClient } = require('@supabase/supabase-js');
const { ProxyAgent, request: undiciRequest } = require('undici');
const crypto = require('crypto');
const { getSharedHomeProxy, ROTATE_MS } = require('./_lib/homeproxy-shared');
const VUBEL_BASE='https://api.vubel.store';
const VUBEL_TIMEOUT_MS=30000, COOKIE_TTL_MS=7*86400000, CHUNK=100;
class UserError extends Error{constructor(message,status=400,code='REQUEST_FAILED',extra={}){super(message);this.status=status;this.code=code;this.extra=extra;}}
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
function fp(proxy){return crypto.createHash('sha256').update(String(proxy||'')).digest('hex').slice(0,24);}
async function userFromReq(req,sb){const h=String(req.headers.authorization||'');if(!h.startsWith('Bearer '))throw new UserError('Bạn chưa đăng nhập',401,'UNAUTHORIZED');const {data,error}=await sb.auth.getUser(h.slice(7));if(error||!data?.user)throw new UserError('Phiên đăng nhập không hợp lệ',401,'UNAUTHORIZED');return data.user;}
async function cleanupExpired(sb){const {error}=await sb.from('shopee_cookie_sessions').delete().lte('expires_at',new Date().toISOString());if(error)console.warn('cookie cleanup:',error.message);}
async function vubel(path,cookie,proxy){
  const dispatcher=new ProxyAgent(proxy);
  try{
    const r=await undiciRequest(VUBEL_BASE+path,{method:'POST',dispatcher,signal:AbortSignal.timeout(VUBEL_TIMEOUT_MS),headersTimeout:VUBEL_TIMEOUT_MS,bodyTimeout:VUBEL_TIMEOUT_MS,headers:{'x-api-key':env('VUBEL_API_KEY'),'Cookie':cookie,'Content-Type':'application/json'},body:JSON.stringify({proxy})});
    const text=await r.body.text();let data;try{data=JSON.parse(text)}catch(_){data={raw:text}}
    if(r.statusCode<200||r.statusCode>=300){const msg=clean(data?.message||data?.title)||('HTTP '+r.statusCode);const authBad=r.statusCode===401||r.statusCode===403||(r.statusCode<500&&/cookie\s*(invalid|expired|không hợp lệ|hết hạn)|invalid\s*cookie|not\s*logged\s*in|chưa đăng nhập|đăng nhập lại/i.test(msg));throw new UserError('Vubel: '+msg,authBad?401:502,authBad?'COOKIE_INVALID':'VUBEL_ERROR');}
    return data;
  }catch(e){if(e instanceof UserError)throw e;if(isTimeout(e))throw new UserError('Vubel phản hồi quá chậm, vui lòng thử lại sau.',504,'VUBEL_TIMEOUT');console.error('vubel request:',path,e);throw new UserError('Không kết nối được tới Vubel/proxy, vui lòng thử lại.',502,'VUBEL_UNREACHABLE');}
  finally{try{await dispatcher.close()}catch(_){}}
}
function inner(d){return d?.data?.data||d?.data||d||{};}
function ordersFrom(d){const x=inner(d);if(Array.isArray(x?.orders))return x.orders;if(Array.isArray(x?.order_list))return x.order_list;if(Array.isArray(x?.list))return x.list;if(Array.isArray(x))return x;return [];}
function first(o,paths,def=null){for(const p of paths){let v=o;for(const k of p.split('.'))v=v?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return def;}
function tracking(o){const ships=o?.shipping?.shipments||o?.shipments||[];return first(o,['shipping.trackingNumber','shipping.tracking_number','trackingNumber','tracking_number','tracking_no','tracking_code'])||first(ships?.[0]||{},['trackingNumber','tracking_number','trackingNo','tracking_no']);}
function carrier(o){const ships=o?.shipping?.shipments||o?.shipments||[];return String(first(o,['shipping.carrier','carrier'])||first(ships?.[0]||{},['carrier','carrierName','logisticsName'])||'');}
function itemName(o){const pools=[o?.items,o?.item_list,o?.order_items,o?.products,(Array.isArray(o?.parcels)?o.parcels.flatMap(p=>p?.items||p?.item_list||[]):[])].filter(Array.isArray);const names=pools.flat().map(x=>first(x,['name','itemName','item_name','productName','product_name','title','model.name','model_name','item.name','product.name'],'')).filter(Boolean);return [...new Set(names.map(String))].join(' • ')||String(first(o,['product_name','productName','item_name','itemName'],'')||'Đơn Shopee');}
function amount(o){const n=Number(first(o,['payment.amountPaid','payment.total','payment.subtotal','total_amount','amount','price'],0));return Number.isFinite(n)?Math.round(n):0;}
function normalize(o){
  const sn=first(o,['orderSn','order_sn','ordersn','orderId','order_id','id']);if(!sn)return null;
  const recipient=o?.recipient||o?.recipient_address||o?.shipping?.recipient||o?.shipping?.address||{};const tr=tracking(o);
  const st=String(first(o,['statusLabel','status_label','processing.statusLabel','processing.status_label','status'],'Đang chờ giao'));
  const addrParts=[first(recipient,['address','fullAddress','full_address','address_detail','detail']),first(recipient,['ward','ward_name']),first(recipient,['district','district_name']),first(recipient,['city','city_name','province','province_name'])].filter(Boolean).map(String);
  const addr=[...new Set(addrParts)].join(', ');
  return {sn:String(sn),orderId:first(o,['orderId','order_id']),tracking:tr?String(tr).trim().toUpperCase():null,carrier:carrier(o),product:itemName(o),amount:amount(o),status:st,recipient_name:String(first(recipient,['name','fullName','full_name','recipient_name'],'')||first(o,['recipient_name','buyer_name'],'')||''),recipient_phone:String(first(recipient,['phone','phoneNumber','phone_number','mobile'],'')||first(o,['recipient_phone'],'')||'').replace(/[^\d+]/g,''),recipient_address:String(addr||first(o,['shipping_address','recipient_address','address'],'')||''),raw:o};
}
function accountMeta(account,cookie){
  const userid=String(first(account,['userid','userId','user_id','id'],'')||'').trim();
  const username=String(first(account,['username','nickname','name'],'')||'').trim();
  const email=String(first(account,['email','email_address','emailAddress'],'')||'').trim();
  const account_key=userid?'uid:'+userid:'cookie:'+crypto.createHash('sha256').update(cookie).digest('hex').slice(0,32);
  return {account_key,account_userid:userid||null,account_username:username||null,account_email:email||null};
}
async function saveOrders(sb,userId,sessionId,rawOrders,accountInfo){
  const byCode=new Map();for(const o of rawOrders){const x=normalize(o);if(x)byCode.set(x.sn,x);}const list=[...byCode.values()];
  if(!list.length)return {total:0,inserted:0,updated:0,new_tracking:0,pending:0};
  const prevMap=new Map();for(const part of chunks(list.map(x=>x.sn),200)){const {data,error}=await sb.from('shopee_orders').select('id,order_code,tracking_number,source,product_name,email,amount,price,recipient_name,recipient_phone,shipping_address').eq('user_id',userId).in('order_code',part);if(error)throw error;for(const r of data||[])prevMap.set(String(r.order_code),r);}
  let inserted=0,updated=0,newTracking=0,pending=0;const now=new Date().toISOString();const accountEmail=String(first(accountInfo||{},['email','email_address','emailAddress'],'')||'').trim();
  const payloads=list.map(x=>{const prev=prevMap.get(x.sn),keep=!!prev&&!!prev.source&&prev.source!=='cookie';const trk=x.tracking||prev?.tracking_number||null,resolved=!!trk;if(!resolved)pending++;if(x.tracking&&!prev?.tracking_number)newTracking++;if(prev)updated++;else inserted++;const o=x.raw;return {user_id:userId,cookie_session_id:sessionId,order_code:x.sn,shopee_order_sn:x.sn,product_name:keep?(prev.product_name||x.product):x.product,email:keep?(prev.email||accountEmail):(accountEmail||null),amount:keep?(prev.amount||x.amount):x.amount,price:keep?(prev.price||x.amount):x.amount,status:x.status||'Đang chờ giao',source:keep?prev.source:'cookie',recipient_name:keep?(prev.recipient_name||x.recipient_name):x.recipient_name,recipient_phone:keep?(prev.recipient_phone||x.recipient_phone):x.recipient_phone,shipping_address:keep?(prev.shipping_address||x.recipient_address):x.recipient_address,tracking_number:trk,tracking_status:resolved?'found':'waiting',vubel_tracking_resolved:resolved,last_synced_at:now,status_key:first(o,['statusKey','status_key']),status_label:first(o,['statusLabel','status_label','processing.statusLabel','processing.status_label','status']),recipient_json:o?.recipient||{},shops_json:o?.shops||[],parcels_json:o?.parcels||[],items_json:o?.items||[],payment_json:o?.payment||{},shipping_json:o?.shipping||{},processing_json:o?.processing||{},coins_json:o?.coins||{},vubel_account_json:accountInfo||{},vubel_raw:o};});
  const idByCode=new Map();for(const part of chunks(payloads,CHUNK)){const {data,error}=await sb.from('shopee_orders').upsert(part,{onConflict:'user_id,order_code'}).select('id,order_code');if(error)throw error;for(const r of data||[])idByCode.set(String(r.order_code),r.id);}
  const trackRows=list.filter(x=>x.tracking&&idByCode.has(x.sn)).map(x=>({order_id:Number(idByCode.get(x.sn)),user_id:userId,tracking_code:x.tracking,tracking_status:x.status||'Đã có mã vận đơn',updated_at:now}));let trackingWarning=false;
  try{for(const part of chunks(trackRows,CHUNK)){const {error}=await sb.from('shopee_tracking').upsert(part,{onConflict:'order_id'});if(error)throw error;}}catch(te){trackingWarning=true;console.error('shopee_tracking upsert:',te?.message||te);}
  return {total:list.length,inserted,updated,new_tracking:newTracking,pending,tracking_warning:trackingWarning};
}
async function sessionById(sb,userId,id){const {data,error}=await sb.from('shopee_cookie_sessions').select('*').eq('id',id).eq('user_id',userId).maybeSingle();if(error)throw error;return data;}
async function pendingQueue(sb,userId,refreshAll=false){
  let q=sb.from('shopee_orders').select('cookie_session_id').eq('user_id',userId).eq('source','cookie');if(!refreshAll)q=q.eq('vubel_tracking_resolved',false);
  const {data,error}=await q;if(error)throw error;const ids=[...new Set((data||[]).map(x=>x.cookie_session_id).filter(Boolean))];if(!ids.length)return [];
  const {data:ss,error:se}=await sb.from('shopee_cookie_sessions').select('id,account_userid,account_username,account_email,active,expires_at,last_sync_at').eq('user_id',userId).in('id',ids);if(se)throw se;
  return (ss||[]).filter(s=>s.active&&new Date(s.expires_at).getTime()>Date.now()).sort((a,b)=>String(a.account_username||a.account_userid||a.id).localeCompare(String(b.account_username||b.account_userid||b.id))).map(s=>({id:s.id,label:s.account_username||s.account_email||s.account_userid||'Tài khoản Shopee'}));
}
async function processSession(sb,user,sessionId,previousProxyFp,refreshAll){
  const s=await sessionById(sb,user.id,sessionId);if(!s)throw new UserError('Không tìm thấy Cookie của tài khoản này.',404,'SESSION_NOT_FOUND');
  if(!s.active)throw new UserError('Cookie tài khoản này không còn hiệu lực.',400,'COOKIE_INVALID');
  if(new Date(s.expires_at).getTime()<=Date.now())throw new UserError('Cookie tài khoản này đã hết hạn.',400,'COOKIE_EXPIRED');
  let cookie;try{cookie=dec(s.cookie_enc);}catch(_){await sb.from('shopee_cookie_sessions').update({active:false,last_error:'DECRYPT_FAILED',updated_at:new Date().toISOString()}).eq('id',s.id);throw new UserError('Không giải mã được Cookie tài khoản này.',400,'COOKIE_INVALID');}
  let hp;try{hp=await getSharedHomeProxy();}catch(e){console.error('homeproxy:',e);throw new UserError('Không lấy được proxy, vui lòng thử lại.',502,'PROXY_ERROR');}
  const currentFp=fp(hp.proxy);
  // Trong một lượt multi-account, tài khoản kế tiếp tuyệt đối không dùng lại proxy của tài khoản trước.
  if(previousProxyFp&&currentFp===previousProxyFp){const wait=Math.max(1000,(ROTATE_MS||61000)-Number(hp.age_ms||0)+800);return {ok:true,wait_proxy:true,wait_ms:wait,session_id:s.id,account:s.account_username||s.account_email||s.account_userid||'Shopee'};}
  const [infoR,ordersR]=await Promise.allSettled([vubel('/v1/shopee/info',cookie,hp.proxy),vubel('/v1/shopee/get_order',cookie,hp.proxy)]);
  if(ordersR.status==='rejected'){const err=ordersR.reason;if(isCookieInvalid(err))await sb.from('shopee_cookie_sessions').update({active:false,last_error:'COOKIE_INVALID',updated_at:new Date().toISOString()}).eq('id',s.id);throw err;}
  const account=infoR.status==='fulfilled'?inner(infoR.value):{};const result=await saveOrders(sb,user.id,s.id,ordersFrom(ordersR.value),account);
  await sb.from('shopee_cookie_sessions').update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',s.id);
  return {ok:true,...result,session_id:s.id,account:s.account_username||s.account_email||s.account_userid||'Shopee',proxy_fingerprint:currentFp,proxy:{provider:hp.provider,location:hp.location,reused:hp.reused,age_ms:hp.age_ms}};
}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,message:'Method not allowed'});
  try{
    const sb=admin(),user=await userFromReq(req,sb),action=String(req.body?.action||'import'),nowMs=Date.now();await cleanupExpired(sb);
    if(action==='status'){
      const {data:ss,error}=await sb.from('shopee_cookie_sessions').select('id,account_userid,account_username,account_email,active,expires_at').eq('user_id',user.id);if(error)throw error;
      const active=(ss||[]).filter(s=>s.active&&new Date(s.expires_at).getTime()>nowMs);
      const {count:pending,error:pe}=await sb.from('shopee_orders').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('source','cookie').eq('vubel_tracking_resolved',false);if(pe)throw pe;
      return res.status(200).json({ok:true,account_count:active.length,pending:pending||0,accounts:active.map(s=>({id:s.id,label:s.account_username||s.account_email||s.account_userid||'Tài khoản Shopee',expires_at:s.expires_at}))});
    }
    if(action==='delete'){const id=String(req.body?.session_id||'');let q=sb.from('shopee_cookie_sessions').delete().eq('user_id',user.id);if(id)q=q.eq('id',id);const {error}=await q;if(error)throw error;return res.status(200).json({ok:true,deleted:true});}
    if(action==='queue'){const mode=String(req.body?.mode||'sync');const queue=await pendingQueue(sb,user.id,mode==='refresh');return res.status(200).json({ok:true,queue,mode});}
    if(action==='sync_account'||action==='refresh_account'){
      const id=String(req.body?.session_id||'');if(!id)throw new UserError('Thiếu tài khoản cần đồng bộ.',400,'NO_SESSION');
      const r=await processSession(sb,user,id,String(req.body?.previous_proxy_fingerprint||''),action==='refresh_account');return res.status(200).json(r);
    }
    if(action!=='import')throw new UserError('Action không hợp lệ',400,'BAD_ACTION');
    if(!String(req.body?.cookie||'').trim())throw new UserError('Cookie Shopee đang trống',400,'EMPTY_COOKIE');
    const cookie=cookieHeader(req.body.cookie);let hp;try{hp=await getSharedHomeProxy();}catch(e){throw new UserError('Không lấy được proxy, vui lòng thử lại.',502,'PROXY_ERROR');}
    const [infoR,ordersR]=await Promise.allSettled([vubel('/v1/shopee/info',cookie,hp.proxy),vubel('/v1/shopee/get_order',cookie,hp.proxy)]);if(ordersR.status==='rejected')throw ordersR.reason;
    const account=infoR.status==='fulfilled'?inner(infoR.value):{};const meta=accountMeta(account,cookie);const now=new Date().toISOString();
    const row={user_id:user.id,...meta,cookie_enc:enc(cookie),active:true,expires_at:new Date(nowMs+COOKIE_TTL_MS).toISOString(),last_sync_at:now,last_error:null,updated_at:now};
    const {data:session,error:se}=await sb.from('shopee_cookie_sessions').upsert(row,{onConflict:'user_id,account_key'}).select('id').single();if(se)throw se;
    const result=await saveOrders(sb,user.id,session.id,ordersFrom(ordersR.value),account);
    return res.status(200).json({ok:true,...result,session_id:session.id,account:{userid:meta.account_userid,username:meta.account_username,email:meta.account_email},account_count:null});
  }catch(e){console.error('shopee-cookie-orders:',e);if(e instanceof UserError)return res.status(e.status).json({ok:false,error:e.code,message:e.message,...(e.extra||{})});return res.status(500).json({ok:false,error:'SYNC_FAILED',message:'Đồng bộ thất bại, vui lòng thử lại sau ít phút.'});}
};
