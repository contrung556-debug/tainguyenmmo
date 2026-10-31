// ============================================================
// NK MMO Store V28.7.23 - Telegram batch /track + Auto Watch + Full Anti-Spam
// Commands:
// /track -> bot asks for up to 5 codes in the next message
// SPX line: SPXVN...
// GHN line: GYRA83K3|1234
// Submitted active shipments are watched automatically
// /unwatch <tracking_code>
// /list /order /me /id
// Anti-spam additions:
// - Telegram update_id dedupe
// - /track cooldown
// - shared short-lived tracking cache
// - existing per-user DB quotas remain enabled
// ============================================================

const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 15000;
const TRACK_COOLDOWN_SECONDS = 8;
const TRACK_CACHE_TTL_SECONDS = 15;

function env(name, required = true) {
  const value = String(process.env[name] || '').trim();
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[m])); }
function fold(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim(); }
function carrierOf(code) {
  code = String(code || '').trim().toUpperCase();
  if (/^SPXVN[A-Z0-9]+$/.test(code)) return 'SPX';
  if (/^[A-Z0-9]{8,20}$/.test(code)) return 'GHN';
  return '';
}
function getSiteUrl(req) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Cannot determine SITE_URL');
  return `${proto}://${host}`;
}
function timingSafeEq(a,b) {
  const aa=Buffer.from(String(a||'')); const bb=Buffer.from(String(b||''));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctl.signal, cache:'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const err = new Error(d?.error?.message || d?.error || d?.message || `HTTP ${r.status}`);
      err.status = r.status; throw err;
    }
    return d;
  } finally { clearTimeout(timer); }
}
function sbHeaders(serviceKey, extra={}) { return { apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json', ...extra }; }
async function sbRpc(base,key,fn,body) { return fetchJson(`${base}/rest/v1/rpc/${fn}`, { method:'POST', headers:sbHeaders(key,{Accept:'application/json'}), body:JSON.stringify(body) }, 8000); }
async function sbGet(base,key,table,query) { return fetchJson(`${base}/rest/v1/${table}?${query}`, { headers:sbHeaders(key,{Accept:'application/json'}) }, 8000); }
async function sbUpsert(base,key,table,body,onConflict) {
  const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return fetchJson(`${base}/rest/v1/${table}${q}`, {
    method:'POST', headers:sbHeaders(key,{Accept:'application/json',Prefer:'resolution=merge-duplicates,return=representation'}), body:JSON.stringify(body)
  }, 8000);
}
async function sbPatch(base,key,table,query,body) {
  const r = await fetch(`${base}/rest/v1/${table}?${query}`, { method:'PATCH', headers:sbHeaders(key,{Prefer:'return=minimal'}), body:JSON.stringify(body), cache:'no-store' });
  if (!r.ok) { const d=await r.json().catch(()=>null); throw new Error(d?.message||d?.error||`Supabase PATCH HTTP ${r.status}`); }
}

function trackingCacheKey(code, phone4='') {
  const carrier=carrierOf(code);
  return crypto.createHash('sha256').update(`${carrier}|${String(code||'').trim().toUpperCase()}|${String(phone4||'')}`).digest('hex');
}
async function getTrackingCache(base,key,code,phone4='') {
  const q=new URLSearchParams();
  q.set('select','payload,expires_at');
  q.set('cache_key',`eq.${trackingCacheKey(code,phone4)}`);
  q.set('expires_at',`gt.${new Date().toISOString()}`);
  q.set('limit','1');
  const rows=await sbGet(base,key,'telegram_tracking_cache',q.toString());
  const row=rows?.[0];
  if(!row?.payload) return null;
  return { ...row.payload, _cache_hit:true };
}
async function setTrackingCache(base,key,item,n) {
  const now=Date.now();
  await sbUpsert(base,key,'telegram_tracking_cache',{
    cache_key:trackingCacheKey(item.code,item.phone4),
    tracking_code:item.code,
    carrier:item.carrier,
    phone_last4:item.carrier==='GHN'?item.phone4:null,
    payload:n,
    cached_at:new Date(now).toISOString(),
    expires_at:new Date(now+TRACK_CACHE_TTL_SECONDS*1000).toISOString()
  },'cache_key');
}
async function checkTrackingCached({base,key,code,phone4,siteUrl,internalSecret}) {
  const cached=await getTrackingCache(base,key,code,phone4);
  if(cached) return cached;
  const n=await checkTracking({code,phone4,siteUrl,internalSecret});
  try{ await setTrackingCache(base,key,{code,carrier:carrierOf(code),phone4},n); }catch(e){ console.warn('TRACK CACHE WRITE:',e?.message||e); }
  return { ...n, _cache_hit:false };
}
async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json'}, body:JSON.stringify(body||{}), cache:'no-store'
  });
  const d = await r.json().catch(()=>null);
  if (!r.ok || d?.ok !== true) { const e=new Error(d?.description||`Telegram ${method} HTTP ${r.status}`); e.status=r.status; throw e; }
  return d.result;
}
async function send(token, chatId, html) {
  return tg(token,'sendMessage',{chat_id:chatId,text:String(html).slice(0,4000),parse_mode:'HTML',disable_web_page_preview:true});
}
function terminalState(raw) {
  const x=raw?.data||raw||{};
  const events=Array.isArray(x.events)?x.events:Array.isArray(x.history)?x.history:Array.isArray(x.tracking)?x.tracking:[];
  const latest=events[0]||{};
  const all=fold([x.status,x.statusText,x.milestone,latest.status,latest.statusText,latest.description].filter(Boolean).join(' | '));
  const delivered=x.delivered===true || all.includes('giao hang thanh cong') || all.includes('da giao thanh cong') || /(^|\W)delivered(\W|$)/.test(all);
  const cancelled=all.includes('da bi huy') || all.includes('don hang da huy') || all.includes('don da huy') || /(^|\W)cancelled(\W|$)/.test(all) || /(^|\W)canceled(\W|$)/.test(all);
  const returned=all.includes('hoan tra thanh cong') || all.includes('tra hang thanh cong') || all.includes('returned successfully') || all.includes('return completed');
  const finished=delivered||cancelled||returned||x.isTerminal===true;
  return { delivered, finished, reason:delivered?'delivered':cancelled?'cancelled':returned?'returned':finished?'terminal':'' };
}
function normalize(raw, carrier, code) {
  const x=raw?.data||raw||{};
  const events=Array.isArray(x.events)?x.events:Array.isArray(x.history)?x.history:Array.isArray(x.tracking)?x.tracking:[];
  const latest=events[0]||{};
  const state=terminalState(raw);
  const status=carrier==='SPX' ? (x.status||latest.status||latest.statusText||latest.description||'Chưa có trạng thái') : (x.statusText||latest.statusText||latest.description||x.status||'Chưa có trạng thái');
  const statusCode=x.tracking_status_code||x.status_code||x.status||latest.status||latest.code||'';
  const milestone=x.milestone||latest.milestone||latest.description||latest.statusText||'';
  const current=x.current_location||latest.current_location||latest?.location?.name||latest?.location?.address||'';
  const next=x.next_location||latest.next_location||'';
  const time=x.time||x.latestUpdate||latest.time||latest.timestamp||null;
  return { code, carrier, status, statusCode, milestone, current, next, time, events, ...state };
}
function fmtTime(v) {
  if(!v) return '';
  const n=Number(v); const d=Number.isFinite(n)&&n>0?new Date(n>1e12?n:n*1000):new Date(v);
  return Number.isNaN(d.getTime())?'':d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
}
function resultHtml(n, title='📦 Trạng thái vận đơn') {
  const lines=[`<b>${esc(title)}</b>`,`<b>Mã:</b> ${esc(n.code)}`,`<b>Hãng:</b> ${esc(n.carrier)}`,`<b>Trạng thái:</b> ${esc(n.status||'Chưa có trạng thái')}`];
  if(n.current) lines.push(`<b>Hiện tại:</b> ${esc(n.current)}`);
  if(n.next) lines.push(`<b>Tiếp theo:</b> ${esc(n.next)}`);
  if(n.time) lines.push(`<b>Cập nhật:</b> ${esc(fmtTime(n.time)||n.time)}`);
  if(n.finished) lines.push(`<b>Kết thúc:</b> ${n.reason==='delivered'?'✅ Đã giao':n.reason==='cancelled'?'❌ Đã hủy':n.reason==='returned'?'↩️ Hoàn trả thành công':'✅ Đã kết thúc'}`);
  const ev=(n.events||[]).slice(0,5);
  if(ev.length){ lines.push('', '<b>5 cập nhật gần nhất:</b>'); ev.forEach((e,i)=>{ const st=e.status||e.statusText||e.description||e.buyer_description||''; const loc=e.current_location||e?.location?.name||e?.location?.address||''; const t=e.time||e.timestamp||e.actual_time||''; lines.push(`${i+1}. ${esc(st)}${loc?' — '+esc(loc):''}${t?' · '+esc(fmtTime(t)||t):''}`); }); }
  return lines.join('\n');
}
function parseCommand(text) {
  const raw=String(text||'').trim(); const parts=raw.split(/\s+/); const cmd=String(parts.shift()||'').split('@')[0].toLowerCase(); return {cmd,args:parts};
}
function adminSet() { return new Set(String(process.env.TELEGRAM_ADMIN_CHAT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean)); }
function planWatchLimit(plan, role) {
  if (role === 'admin') return 100000;
  if (plan === 'pro') return 100;
  return 5;
}
async function getTelegramUser(base,key,chatId) {
  const q=new URLSearchParams(); q.set('select','chat_id,telegram_username,telegram_name,active,role,plan,nk_user_id,created_at,last_seen_at,awaiting_track_until'); q.set('chat_id',`eq.${chatId}`); q.set('limit','1');
  const rows=await sbGet(base,key,'telegram_users',q.toString()); return rows?.[0]||null;
}
async function ensureTelegramUser(base,key,msg,adminIds) {
  const chatId=String(msg.chat.id), isAdmin=adminIds.has(chatId), now=new Date().toISOString();
  const name=[msg.from?.first_name,msg.from?.last_name].filter(Boolean).join(' ').trim();
  const current=await getTelegramUser(base,key,chatId);
  const body={chat_id:chatId,telegram_username:msg.from?.username||null,telegram_name:name||null,last_seen_at:now,updated_at:now};
  if(!current){body.active=true;body.role=isAdmin?'admin':'user';body.plan=isAdmin?'admin':'free';}
  else if(isAdmin && current.role!=='admin'){body.role='admin';body.plan='admin';}
  await sbUpsert(base,key,'telegram_users',body,'chat_id');
  return await getTelegramUser(base,key,chatId);
}
async function maybeSendRateLimitWarning(base,key,token,chatId,retryAfter) {
  try{
    const q=await sbRpc(base,key,'nk_take_tracking_quota',{
      p_key:`tgspamwarn:${chatId}`,p_window_seconds:10,p_limit:1
    });
    if(q?.allowed===true){
      await send(token,chatId,`⏳ Bạn thao tác quá nhanh. Thử lại sau ${Math.max(1,Number(retryAfter||1))} giây.`);
    }
  }catch(e){ console.warn('RATE LIMIT WARNING:',e?.message||e); }
}
async function checkTracking({code,phone4,siteUrl,internalSecret}) {
  const carrier=carrierOf(code); if(!carrier) throw new Error('Mã vận đơn không hợp lệ.');
  let raw;
  if(carrier==='SPX') raw=await fetchJson(`${siteUrl}/api/spx?code=${encodeURIComponent(code)}`,{headers:{'x-nk-internal-secret':internalSecret,Accept:'application/json'}});
  else {
    if(!/^\d{4}$/.test(phone4)) throw new Error('GHN cần đúng 4 số cuối SĐT theo dạng MÃGHN|1234.');
    raw=await fetchJson(`${siteUrl}/api/ghn`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','x-nk-internal-secret':internalSecret},body:JSON.stringify({trackingNumber:code,phoneLast4:phone4})});
  }
  return normalize(raw,carrier,code);
}

function toIso(v) {
  if(!v) return null;
  const n=Number(v);
  const d=Number.isFinite(n)&&n>0 ? new Date(n>1e12?n:n*1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseTrackingBatch(text) {
  const rawLines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!rawLines.length) throw new Error('Bạn chưa gửi mã vận đơn.');
  if(rawLines.length>5) throw new Error('Mỗi lần chỉ gửi tối đa 5 mã, mỗi mã một dòng.');
  const out=[]; const seen=new Set(); let duplicates=0;
  for(const line of rawLines){
    const parts=line.split('|').map(x=>x.trim());
    if(parts.length>2) throw new Error(`Sai định dạng: ${line}`);
    const code=String(parts[0]||'').toUpperCase();
    const carrier=carrierOf(code);
    if(!carrier) throw new Error(`Mã không hợp lệ: ${code||line}`);
    let phone4='';
    if(carrier==='GHN'){
      phone4=digits(parts[1]).slice(-4);
      if(!/^\d{4}$/.test(phone4) || String(parts[1]||'').replace(/\D/g,'').length!==4) {
        throw new Error(`GHN phải nhập dạng ${code}|1234`);
      }
    } else if(parts[1]) {
      throw new Error(`SPX chỉ cần mã vận đơn, không cần |4 số: ${code}`);
    }
    if(seen.has(code)){ duplicates++; continue; }
    seen.add(code); out.push({code,carrier,phone4});
  }
  return {items:out,duplicates};
}
async function saveAutoWatch(base,key,chatId,item,n) {
  const now=new Date().toISOString();
  const signature=crypto.createHash('sha256').update([n.status,n.statusCode,n.milestone,n.current,n.next,n.time].join('|')).digest('hex');
  await sbUpsert(base,key,'telegram_tracking_watch',{
    chat_id:String(chatId),tracking_code:item.code,carrier:item.carrier,
    phone_last4:item.carrier==='GHN'?item.phone4:null,
    last_status:n.status||'',last_status_code:n.statusCode||'',last_milestone:n.milestone||'',
    last_current_location:n.current||'',last_next_location:n.next||'',last_event_at:toIso(n.time),last_signature:signature,
    active:!n.finished,tracking_finished:n.finished===true,finished_reason:n.reason||null,
    finished_at:n.finished?(toIso(n.time)||now):null,last_checked_at:now,
    next_check_at:n.finished?null:new Date(Date.now()+55000).toISOString(),check_fail_count:0,
    check_lock_id:null,check_locked_until:null,updated_at:now
  },'chat_id,tracking_code');
}
function batchSummary(results,duplicates=0) {
  const lines=[`<b>📦 Kết quả ${results.length} mã</b>`];
  if(duplicates) lines.push(`ℹ️ Bỏ qua ${duplicates} mã trùng trong tin nhắn.`);
  lines.push('');
  results.forEach((r,i)=>{
    if(!r.ok){
      lines.push(`${i+1}. <code>${esc(r.code)}</code>`, `❌ ${esc(r.error||'Không tra được')}`,'');
      return;
    }
    const n=r.data;
    lines.push(`${i+1}. <code>${esc(n.code)}</code> · <b>${esc(n.carrier)}</b>`);
    lines.push(`${n.finished?'✅':'🚚'} ${esc(String(n.status||'Chưa có trạng thái').slice(0,350))}`);
    if(n.current) lines.push(`📍 ${esc(String(n.current).slice(0,220))}`);
    lines.push(n.finished
      ? (n.reason==='delivered'?'🏁 Đã giao — dừng theo dõi':n.reason==='cancelled'?'🏁 Đã hủy — dừng theo dõi':n.reason==='returned'?'🏁 Hoàn trả thành công — dừng theo dõi':'🏁 Vận đơn đã kết thúc')
      : '👀 Đã tự động theo dõi, bot sẽ báo khi trạng thái thay đổi.');
    lines.push('');
  });
  return lines.join('\n').trim();
}

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false});}
  try{
    const token=env('TELEGRAM_BOT_TOKEN');
    const webhookSecret=env('TELEGRAM_WEBHOOK_SECRET');
    if(!timingSafeEq(req.headers['x-telegram-bot-api-secret-token'],webhookSecret)) return res.status(403).json({ok:false});

    const update=req.body||{}; const msg=update.message; if(!msg?.chat?.id || !msg?.text) return res.status(200).json({ok:true});
    const chatId=String(msg.chat.id); const {cmd,args}=parseCommand(msg.text);
    const supabaseUrl=env('SUPABASE_URL').replace(/\/$/,''); const serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
    const internalSecret=env('TRACKING_INTERNAL_SECRET'); const siteUrl=getSiteUrl(req);

    // Telegram may retry the exact same webhook update. Claim update_id once in DB
    // before user registration, quota accounting, API lookups, or replies.
    const updateId=Number(update.update_id);
    if(Number.isSafeInteger(updateId)){
      const claimed=await sbRpc(supabaseUrl,serviceKey,'nk_claim_telegram_update',{p_update_id:updateId});
      if(claimed!==true) return res.status(200).json({ok:true,duplicate_update:true});
    }

    const admins=adminSet();
    const tgUser=await ensureTelegramUser(supabaseUrl,serviceKey,msg,admins);

    if(cmd==='/id'){ await send(token,chatId,`Telegram chat ID của bạn: <code>${esc(chatId)}</code>`); return res.status(200).json({ok:true}); }
    if(!tgUser?.active){ await send(token,chatId,'⛔ Tài khoản bot của bạn đang bị tạm khóa.'); return res.status(200).json({ok:true}); }

    // DB-backed anti-spam: 12 messages/10s and 60/minute per chat.
    for (const [key,sec,limit] of [[`tg10:${chatId}`,10,12],[`tg60:${chatId}`,60,60]]) {
      const q=await sbRpc(supabaseUrl,serviceKey,'nk_take_tracking_quota',{p_key:key,p_window_seconds:sec,p_limit:limit});
      if(q?.allowed!==true){
        await maybeSendRateLimitWarning(supabaseUrl,serviceKey,token,chatId,q?.retry_after);
        return res.status(200).json({ok:true,rate_limited:true});
      }
    }

    // Separate cooldown for opening /track input mode.
    if(cmd==='/track'){
      const q=await sbRpc(supabaseUrl,serviceKey,'nk_take_tracking_quota',{
        p_key:`tgcmd:track:${chatId}`,p_window_seconds:TRACK_COOLDOWN_SECONDS,p_limit:1
      });
      if(q?.allowed!==true){
        await maybeSendRateLimitWarning(supabaseUrl,serviceKey,token,chatId,q?.retry_after);
        return res.status(200).json({ok:true,cooldown:true});
      }
    }

    // When /track has opened input mode, the next non-command message is the batch.
    const awaitingUntil=tgUser?.awaiting_track_until ? new Date(tgUser.awaiting_track_until).getTime() : 0;
    if(!String(msg.text||'').trim().startsWith('/') && awaitingUntil>Date.now()){
      await sbPatch(supabaseUrl,serviceKey,'telegram_users',`chat_id=eq.${encodeURIComponent(chatId)}`,{awaiting_track_until:null,updated_at:new Date().toISOString()});
      let parsed;
      try{ parsed=parseTrackingBatch(msg.text); }
      catch(e){ await send(token,chatId,`⚠️ ${esc(e?.message||e)}\n\nBấm /track rồi gửi lại.\n\nSPX: <code>SPXVN...</code>\nGHN: <code>GYRA83K3|1234</code>`); return res.status(200).json({ok:true}); }

      // Max 5 lookups in one user message. Process concurrently, then auto-watch all non-terminal codes.
      const settled=await Promise.all(parsed.items.map(async item=>{
        try{
          const n=await checkTrackingCached({
            base:supabaseUrl,key:serviceKey,code:item.code,phone4:item.phone4,siteUrl,internalSecret
          });
          await saveAutoWatch(supabaseUrl,serviceKey,chatId,item,n);
          return {ok:true,code:item.code,data:n,cache_hit:n._cache_hit===true};
        }catch(e){ return {ok:false,code:item.code,error:String(e?.message||e)}; }
      }));
      await send(token,chatId,batchSummary(settled,parsed.duplicates));
      return res.status(200).json({ok:true,count:settled.length});
    }

    if(cmd==='/start'||cmd==='/help'){
      await send(token,chatId,[
        '<b>🤖 NK Store Tracking Bot</b>','',
        'Bot đang miễn phí. Mã vận đơn chưa kết thúc sẽ được <b>tự động theo dõi</b>.','',
        '<code>/track</code> — mở chế độ nhập tối đa 5 mã',
        'Sau đó gửi một tin nhắn, mỗi mã một dòng:','',
        '<code>SPXVN06854143702A</code>',
        '<code>GYRA83K3|1234</code>','',
        '<code>/list</code> — xem mã đang tự theo dõi',
        '<code>/unwatch MÃ_VẬN_ĐƠN</code> — dừng tự theo dõi một mã',
        '<code>/me</code> — xem tài khoản bot',
        '<code>/order MÃ_ĐƠN_SHOPEE</code> — xem đơn NK Store đã liên kết',
        '<code>/id</code> — xem Telegram chat ID'
      ].join('\n')); return res.status(200).json({ok:true});
    }

    if(cmd==='/me'){
      const q=new URLSearchParams();q.set('select','id');q.set('chat_id',`eq.${chatId}`);q.set('active','eq.true');q.set('tracking_finished','eq.false');
      const rows=await sbGet(supabaseUrl,serviceKey,'telegram_tracking_watch',q.toString());
      await send(token,chatId,[
        '<b>👤 Tài khoản Telegram</b>',`ID: <code>${esc(chatId)}</code>`,`Gói: <b>FREE</b>`,`Đang tự theo dõi: <b>${rows?.length||0}</b> mã`,tgUser?.nk_user_id?'✅ Đã liên kết tài khoản NK Store':'ℹ️ Chưa liên kết tài khoản NK Store'
      ].join('\n')); return res.status(200).json({ok:true});
    }

    if(cmd==='/track'){
      const until=new Date(Date.now()+5*60*1000).toISOString();
      await sbPatch(supabaseUrl,serviceKey,'telegram_users',`chat_id=eq.${encodeURIComponent(chatId)}`,{awaiting_track_until:until,updated_at:new Date().toISOString()});
      await send(token,chatId,[
        '<b>📦 Gửi mã vận đơn</b>','',
        'Gửi tối đa <b>5 mã</b> trong <b>1 tin nhắn</b>.',
        'Mỗi mã phân biệt bằng <b>xuống dòng</b>.','',
        '<b>SPX:</b>', '<code>SPXVN06854143702A</code>','',
        '<b>GHN:</b>', '<code>GYRA83K3|1234</code>','',
        'GHN bắt buộc: <b>MÃGHN|4 số cuối SĐT</b>.',
        'Sau khi tra, bot tự theo dõi các mã chưa kết thúc.'
      ].join('\n')); return res.status(200).json({ok:true});
    }

    // /watch remains removed. Tracking starts automatically after /track batch submission.
    if(cmd==='/watch'){
      await send(token,chatId,'ℹ️ Không cần /watch nữa. Bấm /track, gửi mã; bot sẽ tự theo dõi.');
      return res.status(200).json({ok:true});
    }

    if(cmd==='/unwatch'){
      const code=String(args[0]||'').trim().toUpperCase(); if(!code){await send(token,chatId,'Dùng: <code>/unwatch MÃ_VẬN_ĐƠN</code>');return res.status(200).json({ok:true});}
      await sbPatch(supabaseUrl,serviceKey,'telegram_tracking_watch',`chat_id=eq.${encodeURIComponent(chatId)}&tracking_code=eq.${encodeURIComponent(code)}`,{active:false,updated_at:new Date().toISOString()});
      await send(token,chatId,`✅ Đã dừng tự theo dõi <code>${esc(code)}</code>.`); return res.status(200).json({ok:true});
    }

    if(cmd==='/list'){
      const q=new URLSearchParams();q.set('select','tracking_code,carrier,last_status,active,tracking_finished,finished_reason,updated_at');q.set('chat_id',`eq.${chatId}`);q.set('active','eq.true');q.set('tracking_finished','eq.false');q.set('order','updated_at.desc');q.set('limit','100');
      const rows=await sbGet(supabaseUrl,serviceKey,'telegram_tracking_watch',q.toString());
      if(!rows?.length){await send(token,chatId,'Chưa có mã vận đơn nào đang tự theo dõi.');return res.status(200).json({ok:true});}
      await send(token,chatId,'<b>👀 Đang tự theo dõi</b>\n\n'+rows.map((r,i)=>`${i+1}. <code>${esc(r.tracking_code)}</code> · ${esc(r.carrier)}\n${esc(r.last_status||'Chưa có trạng thái')}`).join('\n\n')); return res.status(200).json({ok:true});
    }

    if(cmd==='/order'){
      // Privacy: users may only query their linked NK Store account; admins may query all.
      const orderCode=String(args[0]||'').trim().replace(/^#/,''); if(!orderCode){await send(token,chatId,'Dùng: <code>/order MÃ_ĐƠN_SHOPEE</code>');return res.status(200).json({ok:true});}
      if(tgUser?.role!=='admin' && !tgUser?.nk_user_id){await send(token,chatId,'🔒 Bạn chưa liên kết tài khoản NK Store nên chưa thể dùng /order.');return res.status(200).json({ok:true});}
      const q=new URLSearchParams();q.set('select','id,order_code,product_name,status,amount,recipient_name,shipping_address,shipping_detail,shipping_ward,shipping_district,shipping_province,created_at,delivered_at,user_id');q.set('order_code',`eq.${orderCode}`);if(tgUser?.role!=='admin')q.set('user_id',`eq.${tgUser.nk_user_id}`);q.set('limit','1');
      const orders=await sbGet(supabaseUrl,serviceKey,'shopee_orders',q.toString()); const o=orders?.[0];
      if(!o){await send(token,chatId,`Không tìm thấy đơn <code>${esc(orderCode)}</code>.`);return res.status(200).json({ok:true});}
      const tq=new URLSearchParams();tq.set('select','tracking_code,tracking_status,current_location,next_location,delivered,tracking_finished,finished_reason,last_event_at');tq.set('order_id',`eq.${o.id}`);tq.set('limit','1');const tracks=await sbGet(supabaseUrl,serviceKey,'shopee_tracking',tq.toString());const t=tracks?.[0]||{};
      const addr=[o.shipping_detail,o.shipping_address,o.shipping_ward,o.shipping_district,o.shipping_province].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', ');
      const html=[`<b>📦 Đơn #${esc(o.order_code)}</b>`,`<b>Trạng thái:</b> ${esc(o.status||'')}`,o.product_name?`<b>Sản phẩm:</b> ${esc(o.product_name)}`:'',o.amount?`<b>Thanh toán:</b> ${Number(o.amount).toLocaleString('vi-VN')}đ`:'',o.recipient_name?`<b>Người nhận:</b> ${esc(o.recipient_name)}`:'',addr?`<b>Địa chỉ:</b> ${esc(addr)}`:'',t.tracking_code?`<b>Vận đơn:</b> <code>${esc(t.tracking_code)}</code>`:'',t.tracking_status?`<b>Vận chuyển:</b> ${esc(t.tracking_status)}`:'',t.current_location?`<b>Hiện tại:</b> ${esc(t.current_location)}`:'',t.next_location?`<b>Tiếp theo:</b> ${esc(t.next_location)}`:''].filter(Boolean).join('\n');
      await send(token,chatId,html); return res.status(200).json({ok:true});
    }

    await send(token,chatId,'Không nhận ra lệnh. Gõ <code>/help</code> để xem hướng dẫn.');
    return res.status(200).json({ok:true});
  }catch(e){
    console.error('TELEGRAM WEBHOOK:',e);
    // Return 200 after validation so Telegram does not retry a bad user command forever.
    try{const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();const chatId=String(req.body?.message?.chat?.id||'');if(token&&chatId)await send(token,chatId,`❌ Có lỗi: ${esc(e?.message||e)}`);}catch(_){ }
    return res.status(200).json({ok:true,error:String(e?.message||e)});
  }
};
