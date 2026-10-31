// ============================================================
// NK MMO Store V28.7.23 - Telegram auto-watch cron
// - Claims up to 80 subscriptions/run.
// - Deduplicates identical carrier/code/phone4 across users: one carrier API lookup per unique shipment.
// - Sends each user a Telegram message only when their saved signature changes.
// - Stops automatically on delivered/cancelled/returned terminal states.
// ============================================================

const crypto=require('crypto');
const DEFAULT_BATCH_SIZE=80, DEFAULT_CONCURRENCY=8, REQUEST_TIMEOUT_MS=12000, LEASE_SECONDS=50;
function env(n,r=true){const v=String(process.env[n]||'').trim();if(r&&!v)throw new Error(`Missing environment variable: ${n}`);return v}
function digits(v){return String(v||'').replace(/\D/g,'')}
function fold(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().replace(/\s+/g,' ').trim()}
function esc(v){return String(v==null?'':v).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}
function carrierOf(c){c=String(c||'').trim().toUpperCase();if(/^SPXVN[A-Z0-9]+$/.test(c))return'SPX';if(/^[A-Z0-9]{8,20}$/.test(c))return'GHN';return''}
function getSiteUrl(req){const s=String(process.env.SITE_URL||'').trim().replace(/\/$/,'');if(s)return s;const p=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim(),h=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();if(!h)throw new Error('Cannot determine SITE_URL');return`${p}://${h}`}
async function fetchJson(url,opt={},timeout=REQUEST_TIMEOUT_MS){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);try{const r=await fetch(url,{...opt,signal:ctl.signal,cache:'no-store'}),d=await r.json().catch(()=>null);if(!r.ok){const e=new Error(d?.error?.message||d?.error||d?.message||`HTTP ${r.status}`);e.status=r.status;throw e}return d}finally{clearTimeout(timer)}}
function hdr(k,e={}){return{apikey:k,Authorization:`Bearer ${k}`,'Content-Type':'application/json',...e}}
async function rpc(base,key,fn,body){return fetchJson(`${base}/rest/v1/rpc/${fn}`,{method:'POST',headers:hdr(key,{Accept:'application/json'}),body:JSON.stringify(body)},8000)}
async function patch(base,key,id,body){const r=await fetch(`${base}/rest/v1/telegram_tracking_watch?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:hdr(key,{Prefer:'return=minimal'}),body:JSON.stringify(body),cache:'no-store'});if(!r.ok){const d=await r.json().catch(()=>null);throw new Error(d?.message||d?.error||`Supabase PATCH HTTP ${r.status}`)}}
async function tg(token,chatId,html){const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:String(html).slice(0,4000),parse_mode:'HTML',disable_web_page_preview:true}),cache:'no-store'}),d=await r.json().catch(()=>null);if(!r.ok||d?.ok!==true){const e=new Error(d?.description||`Telegram HTTP ${r.status}`);e.status=r.status;throw e}return d.result}
function terminalState(raw){const x=raw?.data||raw||{},events=Array.isArray(x.events)?x.events:Array.isArray(x.history)?x.history:Array.isArray(x.tracking)?x.tracking:[],l=events[0]||{},a=fold([x.status,x.statusText,x.milestone,l.status,l.statusText,l.description].filter(Boolean).join(' | '));const delivered=x.delivered===true||a.includes('giao hang thanh cong')||a.includes('da giao thanh cong')||/(^|\W)delivered(\W|$)/.test(a),cancelled=a.includes('da bi huy')||a.includes('don hang da huy')||a.includes('don da huy')||/(^|\W)cancelled(\W|$)/.test(a)||/(^|\W)canceled(\W|$)/.test(a),returned=a.includes('hoan tra thanh cong')||a.includes('tra hang thanh cong')||a.includes('returned successfully')||a.includes('return completed'),finished=delivered||cancelled||returned||x.isTerminal===true;return{delivered,finished,reason:delivered?'delivered':cancelled?'cancelled':returned?'returned':finished?'terminal':''}}
function normalize(raw,carrier,code){const x=raw?.data||raw||{},events=Array.isArray(x.events)?x.events:Array.isArray(x.history)?x.history:Array.isArray(x.tracking)?x.tracking:[],l=events[0]||{},s=terminalState(raw),status=carrier==='SPX'?(x.status||l.status||l.statusText||l.description||'Chưa có trạng thái'):(x.statusText||l.statusText||l.description||x.status||'Chưa có trạng thái'),statusCode=x.tracking_status_code||x.status_code||x.status||l.status||l.code||'',milestone=x.milestone||l.milestone||l.description||l.statusText||'',current=x.current_location||l.current_location||l?.location?.name||l?.location?.address||'',next=x.next_location||l.next_location||'',time=x.time||x.latestUpdate||l.time||l.timestamp||null;return{code,carrier,status,statusCode,milestone,current,next,time,events,...s}}
function fmt(v){if(!v)return'';const n=Number(v),d=Number.isFinite(n)&&n>0?new Date(n>1e12?n:n*1000):new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}
function msg(n){const l=[`<b>📦 Cập nhật cho ${esc(n.code)}</b>`,`<b>Thời gian:</b> ${esc(fmt(n.time)||new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}))}`,`<b>Trạng thái:</b> ${esc(n.status)}`];if(n.current)l.push(`<b>Hiện tại:</b> ${esc(n.current)}`);if(n.next)l.push(`<b>Tiếp theo:</b> ${esc(n.next)}`);if(n.finished)l.push(`<b>Kết thúc:</b> ${n.reason==='delivered'?'✅ Đã giao':n.reason==='cancelled'?'❌ Đã hủy':n.reason==='returned'?'↩️ Hoàn trả thành công':'✅ Đã kết thúc'}`);return l.join('\n')}
function sig(n){return crypto.createHash('sha256').update([n.status,n.statusCode,n.milestone,n.current,n.next,n.time].join('|')).digest('hex')}
async function check(row,site,secret){const code=String(row.tracking_code||'').toUpperCase(),carrier=carrierOf(code);if(!carrier)throw new Error('Unknown carrier');let raw;if(carrier==='SPX')raw=await fetchJson(`${site}/api/spx?code=${encodeURIComponent(code)}`,{headers:{'x-nk-internal-secret':secret,Accept:'application/json'}});else{const p=digits(row.phone_last4).slice(-4);if(!/^\d{4}$/.test(p))throw new Error('Missing GHN phone_last4');raw=await fetchJson(`${site}/api/ghn`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','x-nk-internal-secret':secret},body:JSON.stringify({trackingNumber:code,phoneLast4:p})})}return normalize(raw,carrier,code)}
function iso(v){if(!v)return null;const n=Number(v),d=Number.isFinite(n)&&n>0?new Date(n>1e12?n:n*1000):new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString()}
async function pool(items,n,fn){const out=new Array(items.length);let c=0;async function run(){while(true){const i=c++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={__e:e,row:items[i]}}}}await Promise.all(Array.from({length:Math.min(n,items.length)},run));return out}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({success:false,error:'Method not allowed'});
  }
  try{
    const cron=env('CRON_SECRET');
    if(String(req.headers.authorization||'')!==`Bearer ${cron}`) return res.status(401).json({success:false,error:'Unauthorized'});

    const base=env('SUPABASE_URL').replace(/\/$/,''), key=env('SUPABASE_SERVICE_ROLE_KEY');
    const secret=env('TRACKING_INTERNAL_SECRET'), token=env('TELEGRAM_BOT_TOKEN'), site=getSiteUrl(req);
    const lock=crypto.randomUUID();
    const rows=await rpc(base,key,'nk_claim_telegram_watch_batch',{
      p_limit:Math.min(200,Math.max(1,Number(process.env.TELEGRAM_WATCH_BATCH_SIZE||DEFAULT_BATCH_SIZE))),
      p_lock_id:lock,p_lease_seconds:LEASE_SECONDS
    });
    if(!Array.isArray(rows)||!rows.length) return res.status(200).json({success:true,checked:0,api_lookups:0,message:'No active Telegram watches'});

    // One external lookup per unique shipment, not per Telegram user.
    const groupsMap=new Map();
    for(const row of rows){
      const code=String(row.tracking_code||'').trim().toUpperCase();
      const carrier=carrierOf(code);
      const phone4=carrier==='GHN'?digits(row.phone_last4).slice(-4):'';
      const keyName=`${carrier}|${code}|${phone4}`;
      if(!groupsMap.has(keyName)) groupsMap.set(keyName,{key:keyName,rows:[]});
      groupsMap.get(keyName).rows.push(row);
    }
    const groups=[...groupsMap.values()];
    const concurrency=Math.min(16,Math.max(1,Number(process.env.TELEGRAM_WATCH_CONCURRENCY||DEFAULT_CONCURRENCY)));
    const checkedGroups=await pool(groups,concurrency,async group=>{
      const n=await check(group.rows[0],site,secret);
      return {group,n,signature:sig(n)};
    });

    const results=[];
    let notifications=0;
    for(const g of checkedGroups){
      if(g?.__e){
        const group=g.row;
        for(const row of group.rows){
          const e=g.__e,fc=Math.max(0,Number(row.check_fail_count||0))+1;
          const retry=Math.min(900,60*Math.pow(2,Math.min(fc-1,4))),now=new Date();
          try{
            await patch(base,key,row.id,{
              last_checked_at:now.toISOString(),next_check_at:new Date(now.getTime()+retry*1000).toISOString(),
              check_fail_count:fc,check_lock_id:null,check_locked_until:null,updated_at:now.toISOString(),
              ...(Number(e?.status)===403?{active:false}:{})
            });
          }catch(_){}
          results.push({code:row.tracking_code,chat_id:row.chat_id,ok:false,error:String(e?.message||e),retry_after_seconds:retry});
        }
        continue;
      }

      const {group,n,signature}=g;
      for(const row of group.rows){
        const changed=!row.last_signature||row.last_signature!==signature;
        const now=new Date().toISOString();
        let notifyError='';
        if(changed){
          try{await tg(token,row.chat_id,msg(n));notifications++;}
          catch(e){notifyError=String(e?.message||e);}
        }
        try{
          await patch(base,key,row.id,{
            last_status:n.status||'',last_status_code:n.statusCode||'',last_milestone:n.milestone||'',
            last_current_location:n.current||'',last_next_location:n.next||'',last_event_at:iso(n.time),last_signature:signature,
            active:n.finished?false:true,tracking_finished:n.finished===true,finished_reason:n.reason||null,
            finished_at:n.finished?(iso(n.time)||now):null,last_checked_at:now,
            next_check_at:n.finished?null:new Date(Date.now()+55000).toISOString(),check_fail_count:0,
            check_lock_id:null,check_locked_until:null,updated_at:now
          });
          results.push({code:n.code,chat_id:row.chat_id,ok:true,changed,finished:n.finished,reason:n.reason,notify_error:notifyError||undefined});
        }catch(e){
          results.push({code:n.code,chat_id:row.chat_id,ok:false,error:String(e?.message||e)});
        }
      }
    }

    return res.status(200).json({
      success:true,claimed:rows.length,unique_shipments:groups.length,api_lookups:groups.length,
      checked:results.length,ok:results.filter(x=>x.ok).length,changed:results.filter(x=>x.changed).length,
      notifications,finished:results.filter(x=>x.finished).length,failed:results.filter(x=>!x.ok).length,results
    });
  }catch(e){
    console.error('TELEGRAM WATCH CRON:',e);
    return res.status(500).json({success:false,error:String(e?.message||e)});
  }
}
