// api/proxy-test.js
// Proxy.vn HTTP + SOCKS5 independent tester
// ENV: PROXYVN_KEY
// CommonJS / Vercel

const { ProxyAgent, request } = require("undici");
const { SocksProxyAgent } = require("socks-proxy-agent");
const https = require("https");

const PROXYVN_API = "https://proxyxoay.shop/api/get.php";
const IP_CHECK_URL = "https://api.ipify.org?format=json";

function safe(v) {
  return String(v == null ? "" : v).trim();
}

function normalize(raw, scheme) {
  let p = safe(raw).replace(/::$/, "");
  if (!p) return "";
  if (/^[a-z]+:\/\//i.test(p)) return p;
  return scheme + "://" + p;
}

function classifyError(err) {
  const s = safe((err && (err.code || err.message)) || err).toLowerCase();
  if (s.includes("timeout") || s.includes("timed out") || s.includes("abort")) return "TIMEOUT";
  if (s.includes("auth") || s.includes("407")) return "AUTH_FAILED";
  if (s.includes("refused") || s.includes("econnrefused")) return "CONNECTION_REFUSED";
  if (s.includes("enotfound") || s.includes("dns")) return "DNS_ERROR";
  return "NETWORK_ERROR";
}

async function getProxyVN() {
  const key = process.env.PROXYVN_KEY;
  if (!key) throw new Error("PROXYVN_KEY chÆ°a ÄÆ°á»£c cáº¥u hÃ¬nh trÃªn Vercel");

  const r = await fetch(PROXYVN_API + "?key=" + encodeURIComponent(key), {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error("Proxy.vn tráº£ dá»¯ liá»u khÃ´ng pháº£i JSON"); }

  if (!r.ok) throw new Error("Proxy.vn HTTP " + r.status);
  if (Number(data.status) !== 100) {
    throw new Error(data.message || data.comen || data.msg || "Proxy.vn khÃ´ng cáº¥p ÄÆ°á»£c proxy");
  }

  return {
    http: normalize(data.proxyhttp || data.proxy_http || data.http, "http"),
    socks5: normalize(data.proxysocks5 || data.proxy_socks5 || data.socks5, "socks5"),
    network: data["Nha Mang"] || data["NhÃ  Máº¡ng"] || data.nhamang || null,
    location: data["Vi Tri"] || data["Vá» TrÃ­"] || data.tinhthanh || null,
    message: data.message || null,
    reported_ip: data.ip || null
  };
}

async function testHttp(proxyUrl) {
  const started = Date.now();
  let dispatcher;
  try {
    dispatcher = new ProxyAgent(proxyUrl);
    const r = await request(IP_CHECK_URL, {
      method: "GET",
      dispatcher,
      headersTimeout: 12000,
      bodyTimeout: 12000
    });
    const raw = await r.body.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) {}
    if (r.statusCode < 200 || r.statusCode >= 300) {
      return { ok:false, status:"DIE", error:"HTTP_" + r.statusCode, latency_ms:Date.now()-started };
    }
    return { ok:true, status:"LIVE", ip:data.ip || null, latency_ms:Date.now()-started };
  } catch (e) {
    return { ok:false, status:"DIE", error:classifyError(e), message:safe(e.message), latency_ms:Date.now()-started };
  } finally {
    if (dispatcher && dispatcher.close) {
      try { await dispatcher.close(); } catch (_) {}
    }
  }
}

function testSocks(proxyUrl) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (obj) => {
      if (settled) return;
      settled = true;
      resolve(Object.assign(obj, { latency_ms: Date.now() - started }));
    };

    let agent;
    try {
      agent = new SocksProxyAgent(proxyUrl);
    } catch (e) {
      return finish({ ok:false, status:"DIE", error:classifyError(e), message:safe(e.message) });
    }

    const req = https.get(IP_CHECK_URL, { agent, timeout:12000 }, (resp) => {
      let raw = "";
      resp.on("data", c => raw += c);
      resp.on("end", () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          return finish({ ok:false, status:"DIE", error:"HTTP_" + resp.statusCode });
        }
        let data = {};
        try { data = JSON.parse(raw); } catch (_) {}
        finish({ ok:true, status:"LIVE", ip:data.ip || null });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (e) => {
      finish({ ok:false, status:"DIE", error:classifyError(e), message:safe(e.message) });
    });
  });
}

function page() {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proxy Tester</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;color:#202124}
main{max-width:760px;margin:32px auto;padding:14px}.card{background:#fff;border-radius:18px;padding:20px;box-shadow:0 5px 22px rgba(0,0,0,.06)}
h1{margin:0 0 7px;font-size:25px}.sub{color:#777;font-size:13px;line-height:1.5;margin-bottom:18px}
button{width:100%;border:0;border-radius:13px;padding:15px;background:#ee4d2d;color:#fff;font-weight:800;font-size:15px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:15px}.box{border:1px solid #e4e7eb;border-radius:14px;padding:15px}
.title{font-weight:800}.state{font-size:20px;font-weight:900;margin:8px 0}.live{color:#138a57}.die{color:#c62828}.muted{color:#777;font-size:13px;line-height:1.6}
pre{margin-top:15px;background:#10151b;color:#d9e2ec;border-radius:13px;padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
</style></head><body><main><div class="card">
<h1>TEST PROXY</h1><div class="sub">Kiá»m tra HTTP vÃ  SOCKS5 riÃªng, khÃ´ng qua Vubel/Shopee. Proxy ÄÆ°á»£c láº¥y tá»« PROXYVN_KEY trÃªn Vercel.</div>
<button id="btn" onclick="go()">TEST HTTP + SOCKS5</button>
<div class="grid">
<div class="box"><div class="title">HTTP</div><div id="hs" class="state">ChÆ°a test</div><div id="hd" class="muted">-</div></div>
<div class="box"><div class="title">SOCKS5</div><div id="ss" class="state">ChÆ°a test</div><div id="sd" class="muted">-</div></div>
</div><pre id="raw">// Káº¿t quáº£ JSON</pre></div></main>
<script>
function paint(prefix,r){
 var s=document.getElementById(prefix+"s"),d=document.getElementById(prefix+"d");
 if(!r){s.textContent="N/A";s.className="state die";d.textContent="-";return}
 s.textContent=r.status||"UNKNOWN";s.className="state "+(r.ok?"live":"die");
 d.textContent=r.ok?("IP OUT: "+(r.ip||"-")+" | "+r.latency_ms+" ms"):((r.error||"ERROR")+" | "+r.latency_ms+" ms");
}
async function go(){
 var b=document.getElementById("btn");b.disabled=true;b.textContent="ÄANG TEST...";
 try{
  var r=await fetch("/api/proxy-test",{method:"POST"});
  var data=await r.json();
  document.getElementById("raw").textContent=JSON.stringify(data,null,2);
  paint("h",data.http);paint("s",data.socks5);
 }catch(e){document.getElementById("raw").textContent=JSON.stringify({ok:false,error:e.message},null,2)}
 finally{b.disabled=false;b.textContent="TEST HTTP + SOCKS5"}
}
</script></body></html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(page());
  }
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  try {
    const p = await getProxyVN();
    const [httpResult, socksResult] = await Promise.all([
      p.http ? testHttp(p.http) : Promise.resolve({ok:false,status:"DIE",error:"NO_HTTP_PROXY"}),
      p.socks5 ? testSocks(p.socks5) : Promise.resolve({ok:false,status:"DIE",error:"NO_SOCKS5_PROXY"})
    ]);

    return res.status(200).json({
      ok: Boolean(httpResult.ok || socksResult.ok),
      provider: "Proxy.vn",
      network: p.network,
      location: p.location,
      provider_message: p.message,
      provider_reported_ip: p.reported_ip,
      http: httpResult,
      socks5: socksResult
    });
  } catch (e) {
    return res.status(502).json({ ok:false, stage:"GET_PROXY", error:safe(e.message) });
  }
};
