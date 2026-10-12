const { ProxyAgent, Socks5ProxyAgent, fetch: undiciFetch } = require('undici');

const PROXYVN_API = 'https://proxyxoay.shop/api/get.php';
const CHECK_URLS = [
  'https://api.ipify.org?format=json',
  'https://httpbin.org/ip'
];

function s(v){ return String(v == null ? '' : v).trim(); }
function normalize(raw, scheme){
  let x=s(raw).replace(/::$/, '');
  if(!x) return '';
  if(/^[a-z]+:\/\//i.test(x)) return x;
  return scheme + '://' + x;
}
function mask(url){
  try { const u=new URL(url); return u.protocol+'//'+(u.username?'***:***@':'')+u.hostname+':'+u.port; }
  catch(_){ return '[REDACTED]'; }
}
async function getProxyVN(){
  const key=process.env.PROXYVN_KEY;
  if(!key) throw new Error('PROXYVN_KEY chưa được cấu hình');
  const r=await fetch(PROXYVN_API+'?key='+encodeURIComponent(key), {headers:{Accept:'application/json'}, cache:'no-store', signal:AbortSignal.timeout(15000)});
  const text=await r.text();
  let d; try{ d=JSON.parse(text); }catch(_){ throw new Error('Proxy.vn trả dữ liệu không phải JSON'); }
  if(!r.ok || Number(d.status)!==100) throw new Error(d.message||d.msg||('Proxy.vn HTTP '+r.status));
  return {
    http: normalize(d.proxyhttp||d.proxy_http||d.http||d.proxy, 'http'),
    socks5: normalize(d.proxysocks5||d.proxy_socks5||d.socks5, 'socks5'),
    network: d['Nha Mang']||d['Nhà Mạng']||d.nhamang||null,
    location: d['Vi Tri']||d['Vị Trí']||d.tinhthanh||null,
    message: d.message||null,
    expiration: d['Token expiration date']||null,
    provider_ip: d.ip||null
  };
}
function classifyError(e){
  const msg=s(e && e.message).toLowerCase();
  const code=s(e && (e.code || (e.cause && e.cause.code))).toUpperCase();
  if(msg.includes('timed out')||msg.includes('timeout')||code.includes('TIMEOUT')) return 'TIMEOUT';
  if(msg.includes('authentication')||msg.includes('407')||code.includes('AUTH')) return 'AUTH_FAILED';
  if(msg.includes('refused')||code==='ECONNREFUSED') return 'CONNECTION_REFUSED';
  if(msg.includes('dns')||code==='ENOTFOUND'||code==='EAI_AGAIN') return 'DNS_ERROR';
  return code || 'NETWORK_ERROR';
}
async function testOne(type, proxyUrl){
  if(!proxyUrl) return {type,status:'NOT_PROVIDED'};
  let dispatcher;
  const started=Date.now();
  try{
    dispatcher = type==='SOCKS5'
      ? new Socks5ProxyAgent(proxyUrl, {connectTimeout:8000})
      : new ProxyAgent({uri:proxyUrl, connectTimeout:8000});
    let lastErr=null;
    for(const url of CHECK_URLS){
      try{
        const r=await undiciFetch(url,{dispatcher, headers:{Accept:'application/json'}, signal:AbortSignal.timeout(12000)});
        const raw=await r.text();
        if(!r.ok) throw new Error('CHECK_HTTP_'+r.status);
        let ip='';
        try{ const j=JSON.parse(raw); ip=j.ip||j.origin||''; }catch(_){ ip=raw.trim(); }
        return {type,status:'LIVE',proxy:mask(proxyUrl),exit_ip:s(ip),latency_ms:Date.now()-started,check_url:url,http_status:r.status};
      }catch(e){ lastErr=e; }
    }
    throw lastErr || new Error('Proxy test failed');
  }catch(e){
    return {type,status:'DIE',proxy:mask(proxyUrl),error:classifyError(e),message:s(e&&e.message).slice(0,300),latency_ms:Date.now()-started};
  }finally{
    if(dispatcher){ try{ await dispatcher.close(); }catch(_){} }
  }
}
function page(){ return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proxy Tester</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;color:#202124}.hero{padding:26px 18px 38px;background:linear-gradient(135deg,#ee4d2d,#ff7b45);color:#fff}.wrap{max-width:760px;margin:auto}.main{margin-top:-18px;padding:0 14px 40px}.card{background:#fff;border-radius:18px;padding:18px;margin-bottom:14px;box-shadow:0 5px 22px rgba(0,0,0,.06)}h1,h2{margin:0 0 7px}.sub{font-size:13px;color:#777;line-height:1.5}.btn{width:100%;border:0;border-radius:13px;padding:15px;background:#ee4d2d;color:#fff;font-size:15px;font-weight:800;margin-top:15px}.result{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.box{border:1px solid #e4e7eb;border-radius:14px;padding:14px}.live{color:#087443}.die{color:#c62828}.wait{color:#a75c00}.big{font-size:18px;font-weight:850}.kv{font-size:12px;margin-top:6px;word-break:break-word}pre{background:#10151b;color:#d9e2ec;padding:14px;border-radius:13px;white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto;font-size:12px}@media(max-width:600px){.result{grid-template-columns:1fr}}</style></head><body><div class="hero"><div class="wrap"><h1>TEST PROXY RIÊNG</h1><div>HTTP + SOCKS5 • kiểm tra trực tiếp qua IP service</div></div></div><div class="wrap main"><div class="card"><h2>Proxy.vn</h2><div class="sub">Server lấy proxy bằng PROXYVN_KEY. Không dùng Vubel/Shopee trong bài test này.</div><button class="btn" id="b" onclick="go()">TEST HTTP + SOCKS5</button><div class="result"><div class="box"><b>HTTP</b><div id="h" class="big">Chưa test</div><div id="hd" class="kv"></div></div><div class="box"><b>SOCKS5</b><div id="s" class="big">Chưa test</div><div id="sd" class="kv"></div></div></div></div><div class="card"><h2>JSON</h2><pre id="j">// Kết quả sẽ hiện ở đây</pre></div></div><script>function draw(id,did,x){var e=document.getElementById(id),d=document.getElementById(did);e.textContent=x.status;e.className='big '+(x.status==='LIVE'?'live':x.status==='DIE'?'die':'wait');d.textContent=x.status==='LIVE'?('IP OUT: '+(x.exit_ip||'-')+' • '+x.latency_ms+' ms'):((x.error||'')+(x.message?' • '+x.message:''));}async function go(){var b=document.getElementById('b');b.disabled=true;document.getElementById('h').textContent='Đang test...';document.getElementById('s').textContent='Đang test...';try{var r=await fetch('/api/proxy-test',{method:'POST'});var x=await r.json();document.getElementById('j').textContent=JSON.stringify(x,null,2);if(x.http)draw('h','hd',x.http);if(x.socks5)draw('s','sd',x.socks5);}catch(e){document.getElementById('j').textContent=JSON.stringify({ok:false,error:e.message},null,2)}finally{b.disabled=false}}</script></body></html>`; }

module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method==='GET'){ res.setHeader('Content-Type','text/html; charset=utf-8'); return res.status(200).send(page()); }
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const p=await getProxyVN();
    const [http,socks5]=await Promise.all([testOne('HTTP',p.http),testOne('SOCKS5',p.socks5)]);
    return res.status(200).json({ok:http.status==='LIVE'||socks5.status==='LIVE',provider:'Proxy.vn',network:p.network,location:p.location,message:p.message,expiration:p.expiration,provider_ip:p.provider_ip,http,socks5});
  }catch(e){ return res.status(502).json({ok:false,stage:'GET_PROXY',error:s(e&&e.message)}); }
};
