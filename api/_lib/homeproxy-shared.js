const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const ROTATE_MS = 61000, WAIT_MS = 250, WAIT_MAX_MS = 12000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function env(n){ const v=String(process.env[n]||'').trim(); if(!v) throw new Error('Thiếu biến môi trường '+n); return v; }
function admin(){ return createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}}); }
function proxyToUrl(raw){
  raw=String(raw||'').trim();
  if(/^https?:\/\//i.test(raw)) return raw;
  const p=raw.split(':'); if(p.length<4) throw new Error('HomeProxy trả proxy sai định dạng');
  const ip=p.shift(),port=p.shift(),user=p.shift(),pass=p.join(':');
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`;
}
async function rotateHomeProxy(){
  const r=await fetch('https://app.homeproxy.vn/api/v3/users/rotatev2?token='+encodeURIComponent(env('HOMEPROXY_KEY')),{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||String(d.status).toLowerCase()!=='success'||!d.proxy) throw new Error(d.message||('HomeProxy HTTP '+r.status));
  return {proxy:proxyToUrl(d.proxy),provider:d.provider||'HomeProxy',location:d.location||null};
}
async function state(sb){ const {data,error}=await sb.from('homeproxy_pool').select('*').eq('id',1).maybeSingle(); if(error)throw error; return data; }
async function getSharedHomeProxy(){
  const sb=admin(), owner=crypto.randomUUID(), started=Date.now();
  while(Date.now()-started<WAIT_MAX_MS){
    const s=await state(sb), age=s?.rotated_at?Date.now()-new Date(s.rotated_at).getTime():Infinity;
    if(s?.proxy_url&&age<ROTATE_MS) return {proxy:s.proxy_url,provider:s.provider,location:s.location,age_ms:age,reused:true};
    const {data:claimed,error}=await sb.rpc('claim_homeproxy_rotation',{p_owner:owner}); if(error)throw error;
    if(claimed===true){
      try{
        const fresh=await rotateHomeProxy(), now=new Date().toISOString();
        const {error:u}=await sb.from('homeproxy_pool').update({proxy_url:fresh.proxy,provider:fresh.provider,location:fresh.location,rotated_at:now,rotating:false,lock_owner:null,lock_until:null,updated_at:now}).eq('id',1).eq('lock_owner',owner); if(u)throw u;
        return {...fresh,age_ms:0,reused:false};
      }catch(e){ await sb.from('homeproxy_pool').update({rotating:false,lock_owner:null,lock_until:null,updated_at:new Date().toISOString()}).eq('id',1).eq('lock_owner',owner); throw e; }
    }
    await sleep(WAIT_MS);
  }
  throw new Error('Đang chờ luồng khác đổi HomeProxy quá lâu');
}
module.exports={getSharedHomeProxy,ROTATE_MS};
