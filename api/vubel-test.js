// api/vubel-test.js - CommonJS / Vercel
const VUBEL_BASE = "https://api.vubel.store";

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vubel API Test</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f6f8;color:#202124}.header{background:linear-gradient(135deg,#ee4d2d,#ff7337);color:#fff;padding:24px 16px 34px}.wrap{max-width:760px;margin:auto}.header h1{margin:0 0 5px;font-size:25px}.header p{margin:0;font-size:13px;opacity:.9}.container{max-width:760px;margin:-15px auto 40px;padding:0 13px}.card{background:#fff;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 5px 20px rgba(0,0,0,.06)}h2{margin:0 0 13px;font-size:17px}.sub{font-size:12px;color:#777;margin:-6px 0 14px}label{display:block;margin:13px 0 6px;font-size:13px;font-weight:650}input,textarea{width:100%;border:1px solid #dfe3e8;border-radius:11px;padding:12px;font-size:14px;outline:none}textarea{min-height:90px;resize:vertical}.note{margin-top:12px;background:#fff8e8;border:1px solid #ffe0a3;border-radius:10px;padding:10px 12px;font-size:12px}.danger{background:#fff3f1;border:1px solid #ffc9c2;color:#9d3024;padding:11px;border-radius:10px;font-size:12px;margin-bottom:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}button{border:0;border-radius:11px;padding:13px 10px;cursor:pointer;font-size:13px;font-weight:700;color:#fff}.b1{background:#ee4d2d}.b2{background:#1976d2}.b3{background:#118a55}.b4{background:#ff8a22;width:100%;margin-top:13px}.status{margin-bottom:10px;padding:10px;border-radius:9px;font-size:13px;font-weight:650;background:#f3f4f6}.loading{background:#fff7e6;color:#d46b08}.success{background:#edf9f3;color:#087443}.error{background:#fff1f0;color:#c62828}pre{margin:0;background:#10151b;color:#d9e2ec;border-radius:12px;padding:14px;min-height:190px;max-height:550px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style></head><body>
<div class="header"><div class="wrap"><h1>Vubel API Test</h1><p>NK MMO Store â¢ Test API trÆ°á»c khi tÃ­ch há»£p</p></div></div><div class="container">
<div class="card"><h2>ð PhiÃªn Shopee</h2><div class="sub">DÃ¹ng chung cho cÃ¡c API phÃ­a dÆ°á»i</div><label>SPC_ST</label><textarea id="spc" placeholder="DÃ¡n SPC_ST cá»§a tÃ i khoáº£n test..." autocomplete="off"></textarea><label>Proxy</label><input id="proxy" type="password" placeholder="http://user:pass@ip:port" autocomplete="off"><div class="note">SPC_ST vÃ  Proxy khÃ´ng ÄÆ°á»£c lÆ°u vÃ o localStorage/sessionStorage.</div></div>
<div class="card"><h2>ð§ª Test API</h2><div class="grid"><button class="b1" onclick="runAction('info')">ð¤ THÃNG TIN</button><button class="b2" onclick="runAction('orders')">ð¦ ÄÆ N HÃNG</button><button class="b3" onclick="runAction('addresses')">ð Äá»A CHá»</button></div></div>
<div class="card"><h2>âï¸ Add Mail</h2><div class="danger">â ï¸ CÃ³ thá» thay Äá»i thÃ´ng tin tÃ i khoáº£n Shopee. Chá» dÃ¹ng vá»i tÃ i khoáº£n báº¡n sá» há»¯u hoáº·c ÄÆ°á»£c phÃ©p quáº£n lÃ½.</div><label>Email muá»n thÃªm</label><input id="email" type="email" placeholder="emailcuaban@example.com" autocomplete="off"><button class="b4" onclick="addMail()">âï¸ TEST ADD MAIL</button></div>
<div class="card"><h2>ð Káº¿t quáº£</h2><div id="status" class="status">ChÆ°a gá»­i request</div><pre id="result">// JSON response cá»§a Vubel sáº½ hiá»n á» ÄÃ¢y</pre></div></div>
<script>
var busy=false;
function common(){return{spc_st:document.getElementById("spc").value.trim(),proxy:document.getElementById("proxy").value.trim()}}
function setStatus(t,c){var e=document.getElementById("status");e.className="status "+(c||"");e.textContent=t}
function show(x){document.getElementById("result").textContent=JSON.stringify(x,null,2)}
function valid(d){if(!d.spc_st){alert("ChÆ°a nháº­p SPC_ST");return false}if(!d.proxy){alert("ChÆ°a nháº­p Proxy");return false}if(!(d.proxy.indexOf("http://")===0||d.proxy.indexOf("https://")===0)){alert("Proxy pháº£i báº¯t Äáº§u báº±ng http:// hoáº·c https://");return false}return true}
async function send(payload){if(busy)return;busy=true;setStatus("Äang gá»­i request tá»i Vubel...","loading");try{var r=await fetch("/api/vubel-test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});var text=await r.text(),data;try{data=JSON.parse(text)}catch(e){data={ok:false,status:r.status,raw:text}}show(data);if(r.ok&&data.ok!==false)setStatus("â Vubel pháº£n há»i thÃ nh cÃ´ng","success");else setStatus("â API lá»i - HTTP "+r.status,"error")}catch(e){show({ok:false,error:e.message});setStatus("â KhÃ´ng thá» káº¿t ná»i API","error")}finally{busy=false}}
function runAction(action){var d=common();if(!valid(d))return;send({action:action,spc_st:d.spc_st,proxy:d.proxy})}
function addMail(){var d=common();if(!valid(d))return;var email=document.getElementById("email").value.trim();if(!email||email.indexOf("@")<1||email.lastIndexOf(".")<email.indexOf("@")+2){alert("Email khÃ´ng há»£p lá»");return}if(!confirm("XÃ¡c nháº­n Add Mail:\n\n"+email+"\n\nTiáº¿p tá»¥c?"))return;send({action:"addmail",spc_st:d.spc_st,proxy:d.proxy,email:email})}
</script></body></html>`);
  }

  if (req.method !== "POST") return res.status(405).json({ok:false,error:"Chá» há» trá»£ GET vÃ  POST"});
  const apiKey = process.env.VUBEL_API_KEY;
  if (!apiKey) return res.status(500).json({ok:false,error:"ChÆ°a cáº¥u hÃ¬nh VUBEL_API_KEY trÃªn Vercel"});

  const body=req.body||{};
  const action=String(body.action||"").trim();
  const spc_st=String(body.spc_st||"").trim();
  const proxy=String(body.proxy||"").trim();
  const email=String(body.email||"").trim();

  if(!spc_st)return res.status(400).json({ok:false,error:"Thiáº¿u SPC_ST"});
  if(!proxy)return res.status(400).json({ok:false,error:"Thiáº¿u proxy"});
  if(!(proxy.startsWith("http://")||proxy.startsWith("https://")))return res.status(400).json({ok:false,error:"Proxy pháº£i báº¯t Äáº§u báº±ng http:// hoáº·c https://",example:"http://user:pass@ip:port"});

  let endpoint="";
  let requestBody={proxy:proxy};
  switch(action){
    case "info": endpoint="/v1/shopee/info"; break;
    case "orders": endpoint="/v1/shopee/get_order"; break;
    case "addresses": endpoint="/v1/shopee/addresses/list"; break;
    case "addmail":
      if(!email||email.indexOf("@")<1||email.lastIndexOf(".")<email.indexOf("@")+2)return res.status(400).json({ok:false,error:"Email khÃ´ng há»£p lá»"});
      endpoint="/v1/shopee/addmail";
      requestBody={email:email,proxy:proxy};
      break;
    default:return res.status(400).json({ok:false,error:"Action khÃ´ng há»£p lá»",supported:["info","orders","addresses","addmail"]});
  }

  const headers={"Accept":"application/json","Content-Type":"application/json","x-api-key":apiKey,"Cookie":"SPC_ST="+spc_st};
  try{
    const response=await fetch(VUBEL_BASE+endpoint,{method:"POST",headers:headers,body:JSON.stringify(requestBody)});
    const raw=await response.text();
    let data;try{data=JSON.parse(raw)}catch(_){data={raw:raw.slice(0,5000)}}
    if(response.status===502)return res.status(502).json({ok:false,action:action,endpoint:endpoint,type:"VUBEL_BAD_GATEWAY",message:"Vubel hoáº·c proxy/upstream tráº£ lá»i 502 Bad Gateway.",data:data});
    return res.status(response.status).json({ok:response.ok,action:action,endpoint:endpoint,vubel_status:response.status,data:data});
  }catch(error){
    console.error("Vubel API error:",error);
    return res.status(500).json({ok:false,action:action,endpoint:endpoint,error:"KhÃ´ng thá» káº¿t ná»i Vubel",message:error&&error.message?error.message:String(error)});
  }
};
