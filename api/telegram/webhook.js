// ============================================================
// NK MMO Store V28.7.21 - Telegram multi-user Tracking Bot webhook
// Commands:
// /track <tracking_code> [phone4]
// /order <shopee_order_code>
// /watch <tracking_code> [phone4]
// /unwatch <tracking_code>
// /list
// /id
// ============================================================

const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 15000;

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
  const q=new URLSearchParams(); q.set('select','chat_id,telegram_username,telegram_name,active,role,plan,nk_user_id,created_at,last_seen_at'); q.set('chat_id',`eq.${chatId}`); q.set('limit','1');
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
async function checkTracking({code,phone4,siteUrl,internalSecret}) {
  const carrier=carrierOf(code); if(!carrier) throw new Error('Mã vận đơn không hợp lệ.');
  let raw;
  if(carrier==='SPX') raw=await fetchJson(`${siteUrl}/api/spx?code=${encodeURIComponent(code)}`,{headers:{'x-nk-internal-secret':internalSecret,Accept:'application/json'}});
  else {
    if(!/^\d{4}$/.test(phone4)) throw new Error('GHN cần thêm đúng 4 số cuối SĐT. Ví dụ: /track GYRA83K3 1234');
    raw=await fetchJson(`${siteUrl}/api/ghn`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','x-nk-internal-secret':internalSecret},body:JSON.stringify({trackingNumber:code,phoneLast4:phone4})});
  }
  return normalize(raw,carrier,code);
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

    const admins=adminSet();
    const tgUser=await ensureTelegramUser(supabaseUrl,serviceKey,msg,admins);

    if(cmd==='/id'){ await send(token,chatId,`Telegram chat ID của bạn: <code>${esc(chatId)}</code>`); return res.status(200).json({ok:true}); }
    if(!tgUser?.active){ await send(token,chatId,'⛔ Tài khoản bot của bạn đang bị tạm khóa.'); return res.status(200).json({ok:true}); }

    // DB-backed anti-spam: 12 commands/10s and 60/minute per chat.
    for (const [key,sec,limit] of [[`tg10:${chatId}`,10,12],[`tg60:${chatId}`,60,60]]) {
      const q=await sbRpc(supabaseUrl,serviceKey,'nk_take_tracking_quota',{p_key:key,p_window_seconds:sec,p_limit:limit});
      if(q?.allowed!==true){ await send(token,chatId,`⏳ Bạn thao tác quá nhanh. Thử lại sau ${Math.max(1,Number(q?.retry_after||1))} giây.`); return res.status(200).json({ok:true}); }
    }

    if(cmd==='/start'||cmd==='/help'){
      const limit=planWatchLimit(tgUser?.plan,tgUser?.role);
      await send(token,chatId,[
        '<b>🤖 NK Store Tracking Bot</b>','',
        `Tài khoản: <b>${esc(tgUser?.plan||'free')}</b> · tối đa ${limit>=100000?'không giới hạn':limit} mã đang theo dõi`,'',
        '<code>/track SPXVN...</code> — tra SPX ngay',
        '<code>/track GYRA83K3 1234</code> — tra GHN (4 số cuối SĐT)',
        '<code>/watch SPXVN...</code> — theo dõi, bot tự báo khi đổi trạng thái',
        '<code>/watch GYRA83K3 1234</code> — theo dõi GHN',
        '<code>/unwatch MÃ_VẬN_ĐƠN</code> — dừng theo dõi',
        '<code>/list</code> — danh sách đang theo dõi',
        '<code>/me</code> — xem gói/quyền tài khoản',
        '<code>/order MÃ_ĐƠN_SHOPEE</code> — xem đơn NK Store đã liên kết',
        '<code>/id</code> — xem Telegram chat ID'
      ].join('\n')); return res.status(200).json({ok:true});
    }

    if(cmd==='/me'){
      const q=new URLSearchParams();q.set('select','id');q.set('chat_id',`eq.${chatId}`);q.set('active','eq.true');q.set('tracking_finished','eq.false');
      const rows=await sbGet(supabaseUrl,serviceKey,'telegram_tracking_watch',q.toString());
      const limit=planWatchLimit(tgUser?.plan,tgUser?.role);
      await send(token,chatId,[
        '<b>👤 Tài khoản Telegram</b>',`ID: <code>${esc(chatId)}</code>`,`Gói: <b>${esc(tgUser?.plan||'free')}</b>`,`Quyền: <b>${esc(tgUser?.role||'user')}</b>`,`Đang theo dõi: <b>${rows?.length||0}</b> / ${limit>=100000?'∞':limit}`,tgUser?.nk_user_id?'✅ Đã liên kết tài khoản NK Store':'ℹ️ Chưa liên kết tài khoản NK Store'
      ].join('\n')); return res.status(200).json({ok:true});
    }

    if(cmd==='/track'){
      const code=String(args[0]||'').trim().toUpperCase(); const phone4=digits(args[1]).slice(-4);
      if(!code){await send(token,chatId,'Dùng: <code>/track MÃ_VẬN_ĐƠN</code>\nGHN: <code>/track MÃ_GHN 1234</code>');return res.status(200).json({ok:true});}
      try{const n=await checkTracking({code,phone4,siteUrl,internalSecret});await send(token,chatId,resultHtml(n));}
      catch(e){await send(token,chatId,`❌ Không tra được <code>${esc(code)}</code>\n${esc(e?.message||e)}`);} return res.status(200).json({ok:true});
    }

    if(cmd==='/watch'){
      const code=String(args[0]||'').trim().toUpperCase(); const phone4=digits(args[1]).slice(-4); const carrier=carrierOf(code);
      if(!carrier){await send(token,chatId,'Dùng: <code>/watch MÃ_VẬN_ĐƠN</code>\nGHN: <code>/watch MÃ_GHN 1234</code>');return res.status(200).json({ok:true});}
      if(carrier==='GHN'&&!/^\d{4}$/.test(phone4)){await send(token,chatId,'GHN cần 4 số cuối SĐT. Ví dụ: <code>/watch GYRA83K3 1234</code>');return res.status(200).json({ok:true});}
      const limit=planWatchLimit(tgUser?.plan,tgUser?.role);
      const cq=new URLSearchParams();cq.set('select','tracking_code');cq.set('chat_id',`eq.${chatId}`);cq.set('active','eq.true');cq.set('tracking_finished','eq.false');cq.set('limit',String(limit>=100000?10000:limit+1));
      const currentWatches=await sbGet(supabaseUrl,serviceKey,'telegram_tracking_watch',cq.toString());
      const alreadyWatching=(currentWatches||[]).some(r=>String(r.tracking_code||'').toUpperCase()===code);
      if(!alreadyWatching && (currentWatches?.length||0)>=limit){await send(token,chatId,`⚠️ Gói <b>${esc(tgUser?.plan||'free')}</b> được theo dõi tối đa <b>${limit}</b> mã cùng lúc. Dùng /list hoặc /unwatch để bỏ bớt.`);return res.status(200).json({ok:true});}
      try{
        const n=await checkTracking({code,phone4,siteUrl,internalSecret});
        if(n.finished){await send(token,chatId,resultHtml(n,'📦 Vận đơn đã kết thúc')+'\n\nKhông cần theo dõi thêm.');return res.status(200).json({ok:true});}
        const signature=crypto.createHash('sha256').update([n.status,n.statusCode,n.milestone,n.current,n.next,n.time].join('|')).digest('hex');
        const now=new Date().toISOString();
        await sbUpsert(supabaseUrl,serviceKey,'telegram_tracking_watch',{chat_id:chatId,tracking_code:code,carrier,phone_last4:carrier==='GHN'?phone4:null,last_status:n.status||'',last_status_code:n.statusCode||'',last_milestone:n.milestone||'',last_current_location:n.current||'',last_next_location:n.next||'',last_event_at:n.time?new Date(Number(n.time)>0?(Number(n.time)>1e12?Number(n.time):Number(n.time)*1000):n.time).toISOString():null,last_signature:signature,active:true,tracking_finished:false,finished_reason:null,next_check_at:now,check_fail_count:0,updated_at:now},'chat_id,tracking_code');
        await send(token,chatId,resultHtml(n,'👀 Đã bắt đầu theo dõi')+'\n\nBot sẽ tự nhắn khi trạng thái thay đổi.');
      }catch(e){await send(token,chatId,`❌ Không thể theo dõi <code>${esc(code)}</code>\n${esc(e?.message||e)}`);} return res.status(200).json({ok:true});
    }

    if(cmd==='/unwatch'){
      const code=String(args[0]||'').trim().toUpperCase(); if(!code){await send(token,chatId,'Dùng: <code>/unwatch MÃ_VẬN_ĐƠN</code>');return res.status(200).json({ok:true});}
      await sbPatch(supabaseUrl,serviceKey,'telegram_tracking_watch',`chat_id=eq.${encodeURIComponent(chatId)}&tracking_code=eq.${encodeURIComponent(code)}`,{active:false,updated_at:new Date().toISOString()});
      await send(token,chatId,`✅ Đã dừng theo dõi <code>${esc(code)}</code>.`); return res.status(200).json({ok:true});
    }

    if(cmd==='/list'){
      const q=new URLSearchParams();q.set('select','tracking_code,carrier,last_status,active,tracking_finished,finished_reason,updated_at');q.set('chat_id',`eq.${chatId}`);q.set('active','eq.true');q.set('order','updated_at.desc');q.set('limit','50');
      const rows=await sbGet(supabaseUrl,serviceKey,'telegram_tracking_watch',q.toString());
      if(!rows?.length){await send(token,chatId,'Chưa có mã vận đơn nào đang theo dõi.');return res.status(200).json({ok:true});}
      await send(token,chatId,'<b>👀 Đang theo dõi</b>\n\n'+rows.map((r,i)=>`${i+1}. <code>${esc(r.tracking_code)}</code> · ${esc(r.carrier)}\n${esc(r.last_status||'Chưa có trạng thái')}`).join('\n\n')); return res.status(200).json({ok:true});
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
