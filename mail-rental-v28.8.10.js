/* ============================================================
   NK MMO Store V28.8.10 - Copy Mail + Renew Mail + Hobby Zero-New-Function Fix
   - Separate "Thuê Mail" tab
   - iCloud mail comes only from existing Kho Mail
   - Services: Shopee / Facebook / TikTok
   - Durations: 7 / 30 / 180 days
   - Rental OTP/link requests always send rental_id + service
============================================================ */
(function(){
  const VERSION='V28.8.10';
  const SERVICES={
    shopee:{name:'Shopee',sub:'OTP + Link',kind:'shopee'},
    facebook:{name:'Facebook',sub:'OTP',kind:'facebook'},
    tiktok:{name:'TikTok',sub:'OTP',kind:'tiktok'}
  };
  const DURATIONS={7:'Ngắn hạn',30:'Phổ biến',180:'Dài hạn'};
  const DEFAULT_PRICES={7:500,30:1200,180:2000};
  let state={service:'shopee',days:7,plans:[],rental:null,services:[],busy:false,renewService:null};

  function esc(v){return String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]||m));}
  function fmtMoney(n){return Number(n||0).toLocaleString('vi-VN')+' ₫';}
  function fmtLeft(iso){
    const ms=new Date(iso).getTime()-Date.now();
    if(!Number.isFinite(ms)||ms<=0)return 'Đã hết hạn';
    const d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000);
    return d>0?`${d} ngày ${h} giờ`:`${h} giờ`;
  }
  function fmtDate(iso){
    if(!iso)return '--'; const d=new Date(iso); if(Number.isNaN(d.getTime()))return '--';
    return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  }
  async function getToken(){
    if(typeof _supabase==='undefined') throw Object.assign(new Error('Vui lòng đăng nhập để thuê mail.'),{code:'LOGIN_REQUIRED'});
    const {data,error}=await _supabase.auth.getSession();
    if(error)throw error;
    const t=data?.session?.access_token;
    if(!t)throw Object.assign(new Error('Vui lòng đăng nhập để thuê mail.'),{code:'LOGIN_REQUIRED'});
    return t;
  }
  async function authApi(url,opt={}){
    const t=await getToken();
    const r=await fetch(url,{...opt,cache:'no-store',headers:{Authorization:'Bearer '+t,Accept:'application/json','Content-Type':'application/json',...(opt.headers||{})}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.ok===false){const e=new Error(d.message||d.error||('HTTP '+r.status));e.code=d.error;e.status=r.status;throw e;}
    return d;
  }
  async function loadPlans(){
    try{
      if(typeof _supabase==='undefined') throw new Error('SUPABASE_NOT_READY');
      const {data,error}=await _supabase.from('mail_rental_plans')
        .select('service,days,price_vnd,enabled')
        .eq('enabled',true).order('service').order('days');
      if(error)throw error;
      state.plans=data||[];
    }catch(_){state.plans=[];}
  }
  function getPlan(service,days){
    const found=state.plans.find(p=>p.service===service&&Number(p.days)===Number(days));
    return found||{service,days,price_vnd:DEFAULT_PRICES[days]||0,ui_fallback:true};
  }
  function currentPlan(){return getPlan(state.service,state.days);}
  function toast(msg){
    if(typeof window.dpToast==='function') return window.dpToast(msg,2200);
    let el=document.getElementById('nkrToast');
    if(!el){el=document.createElement('div');el.id='nkrToast';el.className='nkr-toast';document.body.appendChild(el);}
    el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2200);
  }
  async function copyText(value){
    try{
      if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(value);}
      else{
        const ta=document.createElement('textarea');ta.value=value;ta.style.cssText='position:fixed;left:-9999px;top:-9999px';document.body.appendChild(ta);ta.focus();ta.select();document.execCommand('copy');ta.remove();
      }
      toast('✅ Đã sao chép Mail');
      return true;
    }catch(_){toast('Không sao chép được, hãy giữ vào email để copy.');return false;}
  }
  function showMsg(title,msg){
    if(typeof window.showModal==='function') return window.showModal(title,msg);
    alert((title?title+'\n':'')+msg);
  }
  function serviceIcon(s,small=false){
    if(s==='shopee') return `<span class="nkr-logo nkr-logo-shopee${small?' small':''}">S</span>`;
    if(s==='facebook') return `<span class="nkr-logo nkr-logo-fb${small?' small':''}">f</span>`;
    return `<span class="nkr-logo nkr-logo-tt${small?' small':''}">♪</span>`;
  }

  function css(){return `
#sectionMailRental{padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;overflow:visible!important}
#sectionMailRental .nkr-page{max-width:760px;margin:0 auto;padding:12px 10px 28px;background:radial-gradient(circle at 88% 2%,rgba(255,142,102,.10),transparent 24%),linear-gradient(180deg,#fbfcfe,#f6f8fb);border-radius:22px}
.nkr-head{display:grid;grid-template-columns:44px 1fr 88px;align-items:center;gap:10px;padding:2px 4px 6px}.nkr-back{width:42px;height:42px;border:1px solid #e9edf3;border-radius:14px;background:#fff;font-size:27px;display:grid;place-items:center;color:#172033}.nkr-title h2{margin:0;font-size:24px;line-height:1.05;letter-spacing:-.5px}.nkr-title p{margin:5px 0 0;color:#748099;font-size:12px}.nkr-art{height:58px;position:relative}.nkr-art:before{content:"";position:absolute;right:0;top:3px;width:78px;height:49px;border-radius:60% 40%;background:linear-gradient(135deg,#ffe4d9,#fff3ee)}.nkr-envelope{position:absolute;right:7px;top:10px;width:56px;height:37px;border-radius:9px;background:linear-gradient(135deg,#ffb25f,#ff5b2d);transform:rotate(-4deg);box-shadow:0 7px 16px rgba(255,91,45,.16)}.nkr-envelope:before{content:"";position:absolute;left:4px;right:4px;top:2px;height:23px;background:#fff;border-radius:7px 7px 11px 11px;clip-path:polygon(0 0,100% 0,50% 78%)}
.nkr-step{display:flex;justify-content:space-between;align-items:flex-end;gap:8px;margin:18px 3px 10px}.nkr-step-left{display:flex;align-items:center;gap:7px;font-size:15px;font-weight:900;letter-spacing:.8px;color:#26334f}.nkr-num{width:31px;height:31px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#ff9155,#ff5f2f);color:#fff;font-size:16px}.nkr-dot{color:#ff6736;font-size:20px}.nkr-hint{color:#75819a;font-size:11px;text-align:right;padding-bottom:3px}
.nkr-services{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.nkr-service{min-height:112px;border:1px solid #e8ebf1;border-radius:18px;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;padding:10px 4px;cursor:pointer;box-shadow:0 4px 16px rgba(30,40,65,.025)}.nkr-service.active{border:2px solid #ff5b2d;background:linear-gradient(180deg,#fffaf7,#fff);box-shadow:0 10px 24px rgba(255,91,45,.08)}.nkr-check{position:absolute;right:7px;top:7px;width:21px;height:21px;border-radius:50%;display:none;place-items:center;background:#ff5b2d;color:#fff;font-size:13px;font-weight:900}.nkr-service.active .nkr-check,.nkr-duration.active .nkr-check{display:grid}.nkr-iconbox{width:50px;height:50px;border-radius:16px;background:#f7f9fc;display:grid;place-items:center;margin-bottom:8px}.nkr-service b{font-size:15px}.nkr-service small{margin-top:5px;color:#7d8799;font-size:11px}
.nkr-logo{display:grid;place-items:center}.nkr-logo-shopee{width:32px;height:37px;border-radius:5px;background:#ff4c22;color:#fff;font-size:24px;position:relative}.nkr-logo-shopee:before{content:"";position:absolute;top:-9px;left:7px;width:16px;height:12px;border:2px solid #ff4c22;border-bottom:0;border-radius:10px 10px 0 0}.nkr-logo-fb{width:37px;height:37px;border-radius:50%;background:#1778f2;color:#fff;font:bold 29px Arial}.nkr-logo-tt{width:37px;height:37px;border-radius:50%;background:#111;color:#fff;font-size:23px}.nkr-logo.small{transform:scale(.55);transform-origin:center;margin:-8px}
.nkr-durations{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.nkr-duration{min-height:63px;background:#fff;border:1px solid #e8ebf1;border-radius:17px;display:flex;align-items:center;gap:8px;padding:9px;position:relative;cursor:pointer}.nkr-duration.active{border:2px solid #ff5b2d;background:#fffaf7}.nkr-cal{width:35px;height:35px;border-radius:11px;background:#fff1ea;color:#ff5b2d;display:grid;place-items:center;font-size:19px;flex:0 0 auto}.nkr-duration:nth-child(2) .nkr-cal{background:#edf5ff;color:#3479d5}.nkr-duration:nth-child(3) .nkr-cal{background:#f4efff;color:#7751c9}.nkr-duration strong{display:block;font-size:14px}.nkr-duration span{display:block;color:#7e8798;font-size:10.5px;margin-top:3px}
.nkr-summary{margin-top:13px;background:#fff;border:1px solid #e8ebf1;border-radius:20px;padding:15px 14px 13px;box-shadow:0 10px 30px rgba(28,38,70,.055)}.nkr-summary-title{display:flex;align-items:center;gap:8px;font-weight:900;font-size:14px;color:#25314c;margin-bottom:6px}.nkr-doc{width:24px;height:28px;border-radius:6px;background:#47536e;color:#fff;display:grid;place-items:center;font-size:14px}.nkr-row{display:grid;grid-template-columns:36% 64%;align-items:center;min-height:34px;border-bottom:1px solid #eef0f4;font-size:12.5px}.nkr-row:last-of-type{border-bottom:0}.nkr-label{color:#7c879d}.nkr-value{text-align:right;font-weight:850;color:#11172a}.nkr-price{color:#f04d1f}.nkr-service-value{display:inline-flex;align-items:center;gap:7px;justify-content:flex-end}.nkr-notice{margin-top:10px;border:1px solid #ffd5bf;background:#fff7ef;border-radius:13px;padding:10px 11px;display:grid;grid-template-columns:28px 1fr;gap:8px}.nkr-info{width:27px;height:27px;border-radius:50%;background:linear-gradient(135deg,#ffb24c,#ff7a2f);color:#fff;display:grid;place-items:center;font-weight:900}.nkr-notice b{display:block;color:#b2542d;font-size:11.5px;margin-bottom:2px}.nkr-notice span{color:#8d7d76;font-size:9.7px;line-height:1.35}
.nkr-rent{width:100%;height:52px;margin-top:10px;border:0;border-radius:17px;color:#fff;font-weight:900;font-size:18px;background:linear-gradient(90deg,#ff762d,#ff4b23);box-shadow:0 12px 22px rgba(255,81,38,.17);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;cursor:pointer}.nkr-rent:disabled{opacity:.65}.nkr-rent .bolt{justify-self:end;margin-right:10px}.nkr-rent .arrow{justify-self:end;margin-right:18px;font-size:25px}
.nkr-current{margin-top:14px;border:1px solid #cbeedc;background:linear-gradient(180deg,#f4fff9,#f9fffb);border-radius:20px;padding:11px 10px 12px;box-shadow:0 10px 28px rgba(24,184,117,.05)}.nkr-current-head{display:flex;justify-content:space-between;align-items:center;margin:0 5px 9px}.nkr-current-head h3{margin:0;font-size:14px;display:flex;align-items:center;gap:7px}.nkr-gdot{width:8px;height:8px;border-radius:50%;background:#18b875}.nkr-status{background:#e6faef;color:#14895b;border-radius:999px;padding:6px 10px;font-size:10px;display:flex;align-items:center;gap:6px}.nkr-mailcard{background:#fff;border-radius:16px;padding:11px;box-shadow:0 4px 13px rgba(29,54,44,.035)}.nkr-mailtop{display:grid;grid-template-columns:43px 1fr auto;gap:9px;align-items:start}.nkr-icloud{width:43px;height:43px;border-radius:13px;background:#e9f5ff;display:grid;place-items:center}.nkr-icloudin{width:29px;height:29px;border-radius:8px;background:#218bf1;color:#fff;display:grid;place-items:center}.nkr-mailtext small{color:#7f8ca3;font-size:10px}.nkr-mailtext b{display:block;font-size:13px;margin-top:2px;word-break:break-all}.nkr-copy{width:36px;height:36px;border:1px solid #dfe7f1;border-radius:11px;background:#f8fbff;color:#66809f;display:grid;place-items:center;cursor:pointer;padding:0}.nkr-copy:active{transform:scale(.96)}.nkr-copy svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8}.nkr-servchips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0 52px}.nkr-chip{border:1px solid #e6ebf1;background:#f8fafc;color:#58657d;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:800;cursor:pointer}.nkr-chip.active{border-color:#ffb198;background:#fff3ed;color:#e75229}.nkr-mailmeta{display:grid;grid-template-columns:1fr 1px 1fr;gap:10px;align-items:center;margin:10px 0 12px 52px}.nkr-divider{height:28px;background:#e3e8ef}.nkr-meta{display:grid;grid-template-columns:20px 1fr;gap:5px}.nkr-meta small{display:block;color:#7d8799;font-size:9px}.nkr-meta b{display:block;font-size:10.8px;margin-top:2px}.nkr-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.nkr-action{height:38px;border-radius:12px;border:1px solid #ffd1b9;background:#fff4ec;color:#f25a2c;font-size:13px;font-weight:800;cursor:pointer}.nkr-renew{width:100%;height:39px;margin-top:9px;border-radius:12px;border:1px solid #aee5ca;background:#f0fff7;color:#158b5b;font-size:13px;font-weight:900;cursor:pointer}.nkr-renewbox{margin-top:9px;padding:11px;border:1px solid #dbe8e1;background:#fbfffd;border-radius:13px}.nkr-renew-title{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:9px}.nkr-renew-title b{font-size:12px;color:#24344a}.nkr-renew-title button{border:0;background:transparent;color:#8994a5;font-size:18px;cursor:pointer}.nkr-renewopts{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.nkr-renewopt{border:1px solid #dce7e1;background:#fff;border-radius:11px;padding:9px 4px;text-align:center;cursor:pointer;color:#24344a}.nkr-renewopt strong{display:block;font-size:12px}.nkr-renewopt span{display:block;margin-top:3px;font-size:10px;color:#e75b34;font-weight:900}.nkr-renew-note{margin-top:8px;font-size:9.5px;line-height:1.4;color:#788498}.nkr-result{margin-top:9px;padding:10px;border-radius:11px;background:#f8fafc;font-size:12px;display:none;word-break:break-word}.nkr-empty{padding:16px 12px;text-align:center;color:#7c879d;font-size:12px;background:#fff;border-radius:14px}.nkr-error{color:#d33}.nkr-toast{position:fixed;left:50%;bottom:90px;transform:translate(-50%,16px);z-index:99999;background:#172033;color:#fff;padding:10px 14px;border-radius:12px;font-size:12px;font-weight:800;opacity:0;pointer-events:none;transition:.18s;box-shadow:0 10px 30px rgba(0,0,0,.18)}.nkr-toast.show{opacity:1;transform:translate(-50%,0)}
@media(max-width:420px){#sectionMailRental .nkr-page{padding-left:5px;padding-right:5px}.nkr-head{grid-template-columns:42px 1fr 74px}.nkr-title h2{font-size:22px}.nkr-title p{font-size:11px}.nkr-hint{font-size:9.5px}.nkr-service b{font-size:13.5px}.nkr-duration strong{font-size:12.5px}.nkr-duration span{font-size:9.5px}.nkr-row{font-size:11.8px}}
`;}

  function template(){return `<div class="nkr-page">
    <div class="nkr-head"><button type="button" class="nkr-back" data-back>‹</button><div class="nkr-title"><h2>Thuê Mail</h2><p>Thuê mail để sử dụng các dịch vụ online</p></div><div class="nkr-art"><div class="nkr-envelope"></div></div></div>
    <div class="nkr-step"><div class="nkr-step-left"><span class="nkr-num">1</span><span class="nkr-dot">·</span><span>CHỌN DỊCH VỤ</span></div><div class="nkr-hint">Chọn nền tảng bạn muốn sử dụng mail</div></div>
    <div class="nkr-services">${Object.entries(SERVICES).map(([k,v])=>`<button type="button" class="nkr-service${state.service===k?' active':''}" data-service="${k}"><span class="nkr-check">✓</span><span class="nkr-iconbox">${serviceIcon(k)}</span><b>${v.name}</b><small>${v.sub}</small></button>`).join('')}</div>
    <div class="nkr-step"><div class="nkr-step-left"><span class="nkr-num">2</span><span class="nkr-dot">·</span><span>CHỌN THỜI HẠN</span></div><div class="nkr-hint">Thời hạn càng dài càng tiết kiệm</div></div>
    <div class="nkr-durations">${Object.entries(DURATIONS).map(([d,desc],i)=>`<button type="button" class="nkr-duration${Number(d)===state.days?' active':''}" data-days="${d}"><span class="nkr-check">✓</span><span class="nkr-cal">▣</span><span><strong>${d} ngày</strong><span>${desc}</span></span></button>`).join('')}</div>
    <div class="nkr-summary"><div class="nkr-summary-title"><span class="nkr-doc">▤</span>THÔNG TIN ĐƠN THUÊ</div>
      <div class="nkr-row"><span class="nkr-label">Dịch vụ</span><span class="nkr-value"><span class="nkr-service-value">${serviceIcon(state.service,true)}<span id="nkrSumService"></span></span></span></div>
      <div class="nkr-row"><span class="nkr-label">Thời hạn</span><span class="nkr-value" id="nkrSumDays"></span></div>
      <div class="nkr-row"><span class="nkr-label">Mail</span><span class="nkr-value">Lấy tự động từ Kho Mail</span></div>
      <div class="nkr-row"><span class="nkr-label">Giá</span><span class="nkr-value nkr-price" id="nkrPrice"></span></div>
      <div class="nkr-notice"><span class="nkr-info">i</span><div><b>Mail thuê chỉ sử dụng được cho dịch vụ đã chọn</b><span>Hệ thống chỉ trả OTP/link đúng dịch vụ đang còn thời hạn thuê.</span></div></div>
    </div>
    <button type="button" class="nkr-rent" id="nkrRent"><span class="bolt">⚡</span><span>Thuê ngay</span><span class="arrow">›</span></button>
    <div id="nkrCurrent"></div>
    <div style="text-align:center;color:#a0a8b7;font-size:9px;margin-top:10px">NK MMO Store ${VERSION}</div>
  </div>`;}

  function updateSummary(){
    const root=document.getElementById('sectionMailRental'); if(!root)return;
    const s=SERVICES[state.service];
    const n=root.querySelector('#nkrSumService'); if(n)n.textContent=s.name;
    const d=root.querySelector('#nkrSumDays'); if(d)d.textContent=state.days+' ngày';
    const p=currentPlan();
    const visiblePrice=Number(p?.price_vnd||DEFAULT_PRICES[state.days]||0);
    const price=root.querySelector('#nkrPrice'); if(price)price.textContent=fmtMoney(visiblePrice);
  }
  function activeEnt(service){return state.services.find(x=>x.service===service&&x.status==='active'&&new Date(x.expires_at)>new Date());}
  function renderCurrent(){
    const host=document.getElementById('nkrCurrent'); if(!host)return;
    if(!state.rental){host.innerHTML=`<div class="nkr-current"><div class="nkr-current-head"><h3><span class="nkr-gdot"></span>Mail đang thuê</h3></div><div class="nkr-empty">Bạn chưa có mail đang thuê.</div></div>`;return;}
    const active=state.services.filter(x=>x.status==='active'&&new Date(x.expires_at)>new Date());
    const chosen=activeEnt(state.service)||active[0]||null;
    const svc=chosen?.service||state.service;
    const copySvg=`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>`;
    const renewOpen=!!chosen&&state.renewService===svc;
    host.innerHTML=`<div class="nkr-current"><div class="nkr-current-head"><h3><span class="nkr-gdot"></span>Mail đang thuê</h3><span class="nkr-status"><span class="nkr-gdot"></span>Đang hoạt động</span></div>
      <div class="nkr-mailcard"><div class="nkr-mailtop"><div class="nkr-icloud"><span class="nkr-icloudin">✉</span></div><div class="nkr-mailtext"><small>iCloud Mail</small><b>${esc(state.rental.email)}</b></div><button type="button" class="nkr-copy" data-copy aria-label="Sao chép mail" title="Sao chép mail">${copySvg}</button></div>
      <div class="nkr-servchips">${active.map(x=>`<button type="button" class="nkr-chip${x.service===svc?' active':''}" data-chip="${x.service}">${SERVICES[x.service]?.name||x.service} · ${fmtLeft(x.expires_at)}</button>`).join('')}</div>
      ${chosen?`<div class="nkr-mailmeta"><div class="nkr-meta"><span>◷</span><span><small>Thời gian còn lại</small><b>${fmtLeft(chosen.expires_at)}</b></span></div><span class="nkr-divider"></span><div class="nkr-meta"><span>▦</span><span><small>Ngày hết hạn</small><b>${fmtDate(chosen.expires_at)}</b></span></div></div>
      <div class="nkr-actions" style="grid-template-columns:${svc==='shopee'?'1fr 1fr':'1fr'}"><button type="button" class="nkr-action" data-get="${svc}" data-kind="otp">💬 &nbsp; Lấy OTP</button>${svc==='shopee'?`<button type="button" class="nkr-action" data-get="${svc}" data-kind="link">🔗 &nbsp; Lấy Link</button>`:''}</div>
      <button type="button" class="nkr-renew" data-renew="${svc}">↻ &nbsp; Gia hạn Mail</button>
      ${renewOpen?`<div class="nkr-renewbox"><div class="nkr-renew-title"><b>Gia hạn ${esc(SERVICES[svc]?.name||svc)}</b><button type="button" data-renew-close>×</button></div><div class="nkr-renewopts">${[7,30,180].map(days=>{const price=Number(getPlan(svc,days)?.price_vnd||DEFAULT_PRICES[days]||0);return `<button type="button" class="nkr-renewopt" data-renew-days="${days}" data-renew-service="${svc}"><strong>${days} ngày</strong><span>${fmtMoney(price)}</span></button>`}).join('')}</div><div class="nkr-renew-note">Thời gian mua thêm sẽ cộng tiếp vào hạn ${esc(SERVICES[svc]?.name||svc)} hiện tại. Mail vẫn giữ nguyên.</div></div>`:''}
      <div class="nkr-result" id="nkrResult"></div>`:'<div class="nkr-empty" style="margin-top:10px">Không còn dịch vụ nào đang hoạt động.</div>'}</div></div>`;
    host.querySelector('[data-copy]')?.addEventListener('click',()=>copyText(state.rental.email));
    host.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{state.service=b.dataset.chip;state.renewService=null;renderAll();});
    host.querySelectorAll('[data-get]').forEach(b=>b.onclick=()=>fetchRentalMail(b.dataset.get,b.dataset.kind,b));
    host.querySelector('[data-renew]')?.addEventListener('click',e=>{state.renewService=e.currentTarget.dataset.renew;renderCurrent();});
    host.querySelector('[data-renew-close]')?.addEventListener('click',()=>{state.renewService=null;renderCurrent();});
    host.querySelectorAll('[data-renew-days]').forEach(b=>b.onclick=()=>confirmRenew(b.dataset.renewService,Number(b.dataset.renewDays),b));
  }
  function renderAll(){
    const root=document.getElementById('sectionMailRental'); if(!root)return;
    root.querySelectorAll('[data-service]').forEach(x=>x.classList.toggle('active',x.dataset.service===state.service));
    root.querySelectorAll('[data-days]').forEach(x=>x.classList.toggle('active',Number(x.dataset.days)===state.days));
    updateSummary(); renderCurrent();
  }
  async function loadState(){
    await loadPlans();
    try{
      await getToken();
      const {data,error}=await _supabase.rpc('nk_get_my_mail_rental');
      if(error)throw error;
      const d=data||{};
      state.rental=d.rental||null;
      state.services=d.services||[];
    }catch(e){
      if(e.code!=='LOGIN_REQUIRED')console.warn(e);
      state.rental=null;state.services=[];
    }
    renderAll();
  }
  function makeRequestId(service=state.service,days=state.days,mode='rent'){
    const key='nkr_pending_'+mode+'_'+service+'_'+days;
    let id='';
    try{id=sessionStorage.getItem(key)||'';}catch(_){}
    if(!id){
      id=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')?globalThis.crypto.randomUUID():('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);}));
      try{sessionStorage.setItem(key,id);}catch(_){}
    }
    return {id,key};
  }
  function clearRequestKey(key){try{sessionStorage.removeItem(key);}catch(_){}}
  function confirmRent(){
    const p=currentPlan();
    const price=Number(p?.price_vnd||DEFAULT_PRICES[state.days]||0);
    if(price<=0)return showMsg('Chưa có giá','Gói thuê này chưa được cấu hình giá.');
    const text=`Thanh toán ${fmtMoney(price)} để thuê ${SERVICES[state.service].name} trong ${state.days} ngày?`;
    if(typeof window.showModal==='function'){
      return window.showModal('Xác nhận thuê',text,true,res=>{if(res)rent();});
    }
    if(confirm(text))rent();
  }
  async function rent(){
    if(state.busy)return; state.busy=true;
    const btn=document.getElementById('nkrRent'); const old=btn?.innerHTML;
    const req=makeRequestId(state.service,state.days,'rent');
    if(btn){btn.disabled=true;btn.innerHTML='<span></span><span>⏳ Đang thanh toán...</span><span></span>';}
    try{
      await getToken();
      const {data,error}=await _supabase.rpc('nk_rent_icloud_service_self',{
        p_service:state.service,
        p_days:state.days,
        p_request_id:req.id
      });
      if(error)throw error;
      if(!data?.success){
        const ex=new Error(data?.message||data?.error||'Không thể thuê mail.');
        ex.code=data?.error||'RENTAL_FAILED';
        throw ex;
      }
      const d={rental:data,billing:{
        charged:!!data.charged,duplicate:!!data.duplicate,
        price_vnd:Number(data.price_vnd||0),balance:Number(data.balance||0),
        request_id:data.request_id||req.id
      }};
      clearRequestKey(req.key);
      await loadState();
      if(typeof window.updateAuthUI==='function')await window.updateAuthUI();
      const billed=d.billing||{};
      showMsg('Thuê mail thành công',`${SERVICES[state.service].name} · ${state.days} ngày\nĐã trừ: ${fmtMoney(billed.price_vnd||d.rental?.price_vnd||0)}\nSố dư còn: ${fmtMoney(billed.balance||0)}\nMail: ${d.rental?.email||state.rental?.email||''}`);
    }catch(e){
      if(e.code==='INSUFFICIENT_BALANCE')showMsg('Số dư không đủ',e.message||'Vui lòng nạp thêm tiền vào ví.');
      else showMsg('Không thể thuê mail',e.message||'Có lỗi xảy ra.');
    }
    finally{state.busy=false;if(btn){btn.disabled=false;btn.innerHTML=old;}}
  }
  function confirmRenew(service,days,btn){
    const p=getPlan(service,days);
    const price=Number(p?.price_vnd||DEFAULT_PRICES[days]||0);
    if(price<=0)return showMsg('Chưa có giá','Gói gia hạn này chưa được cấu hình giá.');
    const text=`Thanh toán ${fmtMoney(price)} để gia hạn ${SERVICES[service]?.name||service} thêm ${days} ngày?\nMail vẫn giữ nguyên: ${state.rental?.email||''}`;
    if(typeof window.showModal==='function') return window.showModal('Xác nhận gia hạn',text,true,res=>{if(res)renew(service,days,btn);});
    if(confirm(text))renew(service,days,btn);
  }
  async function renew(service,days,btn){
    if(state.busy)return; state.busy=true;
    const old=btn?.innerHTML;
    const req=makeRequestId(service,days,'renew');
    if(btn){btn.disabled=true;btn.innerHTML='<strong>⏳</strong><span>Đang xử lý</span>';}
    try{
      await getToken();
      const {data,error}=await _supabase.rpc('nk_rent_icloud_service_self',{
        p_service:service,
        p_days:days,
        p_request_id:req.id
      });
      if(error)throw error;
      if(!data?.success){const ex=new Error(data?.message||data?.error||'Không thể gia hạn mail.');ex.code=data?.error||'RENEW_FAILED';throw ex;}
      clearRequestKey(req.key);
      state.renewService=null;
      await loadState();
      if(typeof window.updateAuthUI==='function')await window.updateAuthUI();
      showMsg('Gia hạn thành công',`${SERVICES[service]?.name||service} +${days} ngày\nĐã trừ: ${fmtMoney(Number(data.price_vnd||0))}\nSố dư còn: ${fmtMoney(Number(data.balance||0))}\nMail: ${data.email||state.rental?.email||''}`);
    }catch(e){
      if(e.code==='INSUFFICIENT_BALANCE')showMsg('Số dư không đủ',e.message||'Vui lòng nạp thêm tiền vào ví.');
      else showMsg('Không thể gia hạn',e.message||'Có lỗi xảy ra.');
    }finally{state.busy=false;if(btn){btn.disabled=false;btn.innerHTML=old;}}
  }

  async function fetchRentalMail(service,kind,btn){
    if(!state.rental)return;
    const out=document.getElementById('nkrResult'); if(!out)return;
    btn.disabled=true;out.style.display='block';out.innerHTML='⏳ Đang tìm đúng thư '+esc(SERVICES[service]?.name||service)+'...';
    try{
      const q=new URLSearchParams({email:state.rental.email,rental_id:String(state.rental.id),service});
      const d=await authApi('/api/mail?'+q.toString());
      const otp=d.otp?`<div>🔐 OTP: <b style="font-size:19px">${esc(d.otp)}</b></div>`:'';
      const links=(d.links||[]).map(x=>`<div style="margin-top:6px"><a href="${esc(x)}" target="_blank" rel="noopener noreferrer">🔗 Mở Link xác thực</a></div>`).join('');
      if(kind==='link'&&!links)out.innerHTML='Chưa tìm thấy link Shopee mới.';
      else if(kind==='otp'&&!otp)out.innerHTML='Chưa tìm thấy OTP mới.';
      else out.innerHTML=(kind==='link'?links:(otp+links))||'Chưa có OTP/link mới.';
    }catch(e){out.innerHTML='<span class="nkr-error">'+esc(e.message||'Không lấy được OTP/link.')+'</span>';}
    finally{btn.disabled=false;}
  }

  function openRental(){
    document.querySelectorAll('.main-nav-btn').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.section-box').forEach(x=>x.classList.remove('active-section'));
    document.getElementById('navBtnMailRental')?.classList.add('active');
    document.getElementById('sectionMailRental')?.classList.add('active-section');
    window.scrollTo({top:0,behavior:'smooth'}); loadState();
  }
  function mount(){
    if(document.getElementById('sectionMailRental'))return;
    const nav=document.querySelector('.main-nav-bar'); const container=document.querySelector('.container'); if(!nav||!container)return;
    if(!document.getElementById('nkrCss')){const st=document.createElement('style');st.id='nkrCss';st.textContent=css();document.head.appendChild(st);}
    const navBtn=document.createElement('button');navBtn.className='main-nav-btn';navBtn.id='navBtnMailRental';navBtn.innerHTML='📧 Thuê Mail';navBtn.onclick=()=>window.switchMainTab('mailrental');
    const otpBtn=document.getElementById('navBtnOtp'); if(otpBtn)otpBtn.insertAdjacentElement('afterend',navBtn); else nav.appendChild(navBtn);
    const sec=document.createElement('div');sec.className='section-box';sec.id='sectionMailRental';sec.innerHTML=template();
    const otpSec=document.getElementById('sectionOtp'); if(otpSec)otpSec.insertAdjacentElement('afterend',sec);else container.appendChild(sec);

    sec.querySelector('[data-back]')?.addEventListener('click',()=>window.switchMainTab('market'));
    sec.querySelectorAll('[data-service]').forEach(b=>b.onclick=()=>{state.service=b.dataset.service;renderAll();});
    sec.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{state.days=Number(b.dataset.days);renderAll();});
    sec.querySelector('#nkrRent')?.addEventListener('click',confirmRent);

    const previous=window.switchMainTab;
    window.switchMainTab=function(tabName){
      if(tabName==='mailrental')return openRental();
      document.getElementById('navBtnMailRental')?.classList.remove('active');
      document.getElementById('sectionMailRental')?.classList.remove('active-section');
      if(typeof previous==='function')return previous(tabName);
    };
    updateSummary();renderCurrent();loadPlans().then(updateSummary);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  setTimeout(mount,700);
})();
