// api/vubel-test.js
// CommonJS - Vercel
// Tests: Shopee Info, Get Order, Address List, Add Mail (existing email)

const VUBEL_BASE = "https://api.vubel.store";

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");

    return res.status(200).send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vubel API Test</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f6f8;color:#202124}
.hero{background:linear-gradient(135deg,#ee4d2d,#ff7b45);color:#fff;padding:28px 18px 38px}
.hero-inner,.container{max-width:760px;margin:auto}
.hero h1{margin:0 0 6px;font-size:28px}.hero p{margin:0;opacity:.92}
.container{margin-top:-16px;padding:0 14px 40px}
.card{background:#fff;border-radius:18px;padding:20px;margin-bottom:15px;box-shadow:0 5px 22px rgba(0,0,0,.06)}
h2{margin:0 0 6px;font-size:20px}.sub{color:#777;font-size:13px;margin-bottom:17px}
label{display:block;font-size:14px;font-weight:700;margin:14px 0 7px}
input,textarea{width:100%;border:1px solid #d9dde2;border-radius:12px;padding:13px;font-size:15px;outline:none;background:#fff}
textarea{min-height:100px;resize:vertical}
input:focus,textarea:focus{border-color:#ee4d2d;box-shadow:0 0 0 3px rgba(238,77,45,.08)}
.note,.warn{padding:12px;border-radius:11px;margin-top:13px;font-size:13px;line-height:1.5}
.note{background:#fff8e8;border:1px solid #f4d487;color:#6e5514}
.warn{background:#fff3f1;border:1px solid #ffc8c0;color:#9b3024}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
button{border:0;border-radius:12px;padding:14px 10px;font-size:14px;font-weight:750;color:#fff;cursor:pointer}
button:active{transform:scale(.99)}button:disabled{opacity:.55}
.info{background:#e95538}.orders{background:#3978d0}.addresses{background:#3e8d5c}.mail{background:#ef852c;width:100%;margin-top:14px}
.status{padding:11px 12px;border-radius:10px;background:#f3f4f6;font-size:13px;font-weight:700;margin-bottom:11px}
.status.loading{background:#fff7e6;color:#b86500}.status.success{background:#edf9f3;color:#087443}.status.error{background:#fff1f0;color:#c62828}
pre{margin:0;background:#10151b;color:#d9e2ec;border-radius:13px;padding:15px;min-height:190px;max-height:550px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55}
@media(max-width:600px){.grid{grid-template-columns:1fr}.hero h1{font-size:25px}.card{padding:18px}}
</style>
</head>
<body>
<header class="hero"><div class="hero-inner">
<h1>Vubel API Test</h1>
<p>NK MMO Store &bull; Ki&#7875;m tra API tr&#432;&#7899;c khi t&iacute;ch h&#7907;p</p>
</div></header>

<main class="container">
<section class="card">
<h2>Phi&ecirc;n Shopee</h2>
<div class="sub">D&ugrave;ng chung cho c&aacute;c API ph&iacute;a d&#432;&#7899;i</div>
<label for="spc">SPC_ST</label>
<textarea id="spc" placeholder="D&aacute;n SPC_ST c&#7911;a t&agrave;i kho&#7843;n test..." autocomplete="off"></textarea>
<label for="proxy">Proxy</label>
<input id="proxy" type="password" placeholder="http://user:pass@ip:port" autocomplete="off">
<div class="note">SPC_ST v&agrave; Proxy kh&ocirc;ng &#273;&#432;&#7907;c l&#432;u v&agrave;o localStorage/sessionStorage.</div>
</section>

<section class="card">
<h2>Test API</h2>
<div class="sub">N&ecirc;n ch&#7841;y ba ch&#7913;c n&#259;ng ch&#7881; &#273;&#7885;c tr&#432;&#7899;c</div>
<div class="grid">
<button class="info" onclick="runAction('info')">TH&Ocirc;NG TIN</button>
<button class="orders" onclick="runAction('orders')">&#272;&#416;N H&Agrave;NG</button>
<button class="addresses" onclick="runAction('addresses')">&#272;&#7882;A CH&#7880;</button>
</div>
</section>

<section class="card">
<h2>Add Mail</h2>
<div class="sub">S&#7917; d&#7909;ng email b&#7841;n &#273;&atilde; c&oacute;</div>
<div class="warn">Thao t&aacute;c n&agrave;y c&oacute; th&#7875; thay &#273;&#7893;i th&ocirc;ng tin t&agrave;i kho&#7843;n Shopee. Ch&#7881; d&ugrave;ng v&#7899;i t&agrave;i kho&#7843;n b&#7841;n s&#7903; h&#7919;u ho&#7863;c &#273;&#432;&#7907;c ph&eacute;p qu&#7843;n l&yacute;.</div>
<label for="email">Email mu&#7889;n th&ecirc;m</label>
<input id="email" type="email" placeholder="emailcuaban@example.com" autocomplete="off">
<button class="mail" onclick="addMail()">TEST ADD MAIL</button>
</section>

<section class="card">
<h2>K&#7871;t qu&#7843;</h2>
<div id="status" class="status">Ch&#432;a g&#7917;i request</div>
<pre id="result">// JSON response cua Vubel se hien o day</pre>
</section>
</main>

<script>
var busy=false;
function common(){
  return {
    spc_st:document.getElementById("spc").value.trim(),
    proxy:document.getElementById("proxy").value.trim()
  };
}
function setStatus(text,type){
  var el=document.getElementById("status");
  el.className="status "+(type||"");
  el.textContent=text;
}
function show(data){
  document.getElementById("result").textContent=JSON.stringify(data,null,2);
}
function validate(d){
  if(!d.spc_st){alert("Chua nhap SPC_ST");return false;}
  if(!d.proxy){alert("Chua nhap Proxy");return false;}
  if(!(d.proxy.indexOf("http://")===0||d.proxy.indexOf("https://")===0)){
    alert("Proxy phai bat dau bang http:// hoac https://");
    return false;
  }
  return true;
}
async function send(payload){
  if(busy)return;
  busy=true;
  setStatus("Dang gui request toi Vubel...","loading");
  try{
    var response=await fetch("/api/vubel-test",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    var text=await response.text();
    var data;
    try{data=JSON.parse(text);}
    catch(e){data={ok:false,status:response.status,raw:text};}
    show(data);
    if(response.ok&&data.ok!==false){
      setStatus("Vubel phan hoi thanh cong","success");
    }else{
      setStatus("API loi - HTTP "+response.status,"error");
    }
  }catch(e){
    show({ok:false,error:e.message});
    setStatus("Khong the ket noi API","error");
  }finally{
    busy=false;
  }
}
function runAction(action){
  var d=common();
  if(!validate(d))return;
  send({action:action,spc_st:d.spc_st,proxy:d.proxy});
}
function addMail(){
  var d=common();
  if(!validate(d))return;
  var email=document.getElementById("email").value.trim();
  if(!email||email.indexOf("@")<1||email.lastIndexOf(".")<email.indexOf("@")+2){
    alert("Email khong hop le");
    return;
  }
  if(!confirm("Xac nhan Add Mail:\\n\\n"+email+"\\n\\nThao tac nay co the thay doi email tai khoan Shopee. Tiep tuc?"))return;
  send({action:"addmail",spc_st:d.spc_st,proxy:d.proxy,email:email});
}
</script>
</body>
</html>`);
  }

  if (req.method !== "POST") {
    return res.status(405).json({ok:false,error:"Method not allowed"});
  }

  const apiKey = process.env.VUBEL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ok:false,error:"VUBEL_API_KEY is not configured"});
  }

  const body = req.body || {};
  const action = String(body.action || "").trim();
  const spc_st = String(body.spc_st || "").trim();
  const proxy = String(body.proxy || "").trim();
  const email = String(body.email || "").trim();

  if (!spc_st) return res.status(400).json({ok:false,error:"Missing SPC_ST"});
  if (!proxy) return res.status(400).json({ok:false,error:"Missing proxy"});

  // Deliberately avoid regex here so copied source cannot suffer slash escaping issues.
  if (!(proxy.startsWith("http://") || proxy.startsWith("https://"))) {
    return res.status(400).json({
      ok:false,
      error:"Proxy must start with http:// or https://",
      example:"http://user:pass@ip:port"
    });
  }

  let endpoint = "";
  let requestBody = {proxy:proxy};

  switch (action) {
    case "info":
      endpoint = "/v1/shopee/info";
      break;
    case "orders":
      endpoint = "/v1/shopee/get_order";
      break;
    case "addresses":
      endpoint = "/v1/shopee/addresses/list";
      break;
    case "addmail":
      if (!email || email.indexOf("@") < 1 || email.lastIndexOf(".") < email.indexOf("@") + 2) {
        return res.status(400).json({ok:false,error:"Invalid email"});
      }
      endpoint = "/v1/shopee/addmail";
      requestBody = {email:email,proxy:proxy};
      break;
    default:
      return res.status(400).json({
        ok:false,
        error:"Invalid action",
        supported:["info","orders","addresses","addmail"]
      });
  }

  const headers = {
    "Accept":"application/json",
    "Content-Type":"application/json",
    "x-api-key":apiKey,
    "Cookie":"SPC_ST="+spc_st
  };

  try {
    const response = await fetch(VUBEL_BASE + endpoint,{
      method:"POST",
      headers:headers,
      body:JSON.stringify(requestBody)
    });

    const raw = await response.text();
    let data;
    try { data=JSON.parse(raw); }
    catch (_) { data={raw:raw.slice(0,5000)}; }

    if (response.status === 502) {
      return res.status(502).json({
        ok:false,
        action:action,
        endpoint:endpoint,
        type:"VUBEL_BAD_GATEWAY",
        message:"Vubel or proxy/upstream returned 502 Bad Gateway",
        data:data
      });
    }

    return res.status(response.status).json({
      ok:response.ok,
      action:action,
      endpoint:endpoint,
      vubel_status:response.status,
      data:data
    });
  } catch (error) {
    console.error("Vubel API error:",error);
    return res.status(500).json({
      ok:false,
      action:action,
      endpoint:endpoint,
      error:"Cannot connect to Vubel",
      message:error && error.message ? error.message : String(error)
    });
  }
};
