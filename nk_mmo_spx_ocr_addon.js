* NK MMO Store - SPX + OCR addon
   Load this AFTER the main app script, or paste before updateAuthUI().
   Requires public.shopee_tracking and /api/spx already configured.
*/
(function () {
    'use strict';

    function normalizeSpxCode(value) {
        return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    }
    function isValidSpxCode(value) {
        return /^SPXVN[A-Z0-9]+$/.test(normalizeSpxCode(value));
    }
    function extractSpxTrackingCode(text) {
        const s = String(text || '').toUpperCase()
            .replace(/SPX\s*VN\s*/g, 'SPXVN')
            .replace(/SPXVN\s+/g, 'SPXVN');
        const m = s.match(/\bSPXVN[A-Z0-9]{8,25}\b/);
        return m ? m[0] : '';
    }

    window.normalizeSpxCode = normalizeSpxCode;
    window.isValidSpxCode = isValidSpxCode;
    window.extractSpxTrackingCode = extractSpxTrackingCode;

    window.fetchSpxTracking = async function (trackingCode) {
        const code = normalizeSpxCode(trackingCode);
        if (!isValidSpxCode(code)) throw new Error('MÃ£ SPX khÃ´ng há»£p lá»');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const baseUrl = window.location.protocol + '//' + window.location.host;
            const response = await fetch(
                `${baseUrl}/api/spx?code=${encodeURIComponent(code)}`,
                { method: 'GET', signal: controller.signal, cache: 'no-store' }
            );
            const data = await response.json().catch(() => null);
            if (!response.ok || !data || data.success !== true) {
                throw new Error(data?.message || `SPX HTTP ${response.status}`);
            }
            return data;
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('SPX pháº£n há»i quÃ¡ lÃ¢u.');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    };

    window.saveSpxResult = async function (orderId, trackingCode, data) {
        if (!currentUser) return;
        const unixTime = Number(data.time) || 0;
        const eventTime = unixTime > 0 ? new Date(unixTime * 1000).toISOString() : null;
        const now = new Date().toISOString();

        const { error } = await _supabase.from('shopee_tracking').upsert({
            order_id: Number(orderId),
            user_id: currentUser.id,
            tracking_code: normalizeSpxCode(trackingCode),
            tracking_status: data.status || '',
            tracking_status_code: data.tracking_status_code || '',
            milestone: data.milestone || '',
            current_location: data.current_location || '',
            next_location: data.next_location || '',
            delivered: data.delivered === true,
            last_event_at: eventTime,
            last_checked_at: now,
            updated_at: now
        }, { onConflict: 'order_id' });

        if (error) throw error;

        if (data.delivered === true) {
            const { error: orderError } = await _supabase.from('shopee_orders').update({
                status: 'ÄÃ£ giao',
                delivered_at: eventTime || now
            }).eq('id', Number(orderId)).eq('user_id', currentUser.id);
            if (orderError) console.error('UPDATE DELIVERED:', orderError);
        }
    };

    window.checkSpxForOrder = async function (orderId, trackingCode, showResult = true) {
        const code = normalizeSpxCode(trackingCode);
        if (!code) {
            if (showResult) showModal('ChÆ°a cÃ³ mÃ£ SPX', 'ÄÆ¡n nÃ y chÆ°a ÄÆ°á»£c gáº¯n mÃ£ váº­n ÄÆ¡n SPX.');
            return null;
        }
        try {
            const data = await window.fetchSpxTracking(code);
            await window.saveSpxResult(orderId, code, data);
            if (showResult) {
                let html = `<div style="text-align:left;font-size:12px;line-height:1.7">
                    <div><b>ð MÃ£ SPX:</b> ${escapeHtml(code)}</div>
                    <div><b>ð¦ Tráº¡ng thÃ¡i:</b> ${escapeHtml(data.status || 'ChÆ°a cÃ³ tráº¡ng thÃ¡i')}</div>`;
                if (data.milestone) html += `<div><b>ð Tiáº¿n trÃ¬nh:</b> ${escapeHtml(data.milestone)}</div>`;
                if (data.current_location) html += `<div><b>ð Hiá»n táº¡i:</b> ${escapeHtml(data.current_location)}</div>`;
                if (data.next_location) html += `<div><b>â¡ï¸ Äiá»m tiáº¿p:</b> ${escapeHtml(data.next_location)}</div>`;
                if (data.time) html += `<div><b>ð Cáº­p nháº­t:</b> ${new Date(Number(data.time) * 1000).toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'})}</div>`;
                html += `<div style="margin-top:8px;padding:8px;border-radius:8px;background:${data.delivered ? '#ecfdf5' : '#fff7ed'};color:${data.delivered ? '#15803d' : '#c2410c'};font-weight:800">${data.delivered ? 'â ÄÃ GIAO' : 'ð CHÆ¯A GIAO'}</div></div>`;
                showModal(data.delivered ? 'â SPX ÄÃ£ giao' : 'ð Tráº¡ng thÃ¡i SPX', '', false, null, html);
            }
            return data;
        } catch (error) {
            if (showResult) showModal('Lá»i SPX', error.message || 'KhÃ´ng tra ÄÆ°á»£c váº­n ÄÆ¡n SPX.');
            throw error;
        }
    };

    window.openSpxTracking = function (orderId, currentCode = '') {
        showModal(currentCode ? 'ð MÃ£ váº­n ÄÆ¡n SPX' : 'â ThÃªm mÃ£ SPX', '', true, async ok => {
            if (!ok) return;
            const input = document.getElementById('inputSpxTrackingCode');
            const code = normalizeSpxCode(input ? input.value : '');
            if (!isValidSpxCode(code)) {
                showModal('Lá»i', 'MÃ£ váº­n ÄÆ¡n pháº£i cÃ³ dáº¡ng SPXVN...');
                return;
            }
            const { error } = await _supabase.from('shopee_tracking').upsert({
                order_id: Number(orderId),
                user_id: currentUser.id,
                tracking_code: code,
                updated_at: new Date().toISOString()
            }, { onConflict: 'order_id' });
            if (error) {
                showModal('Lá»i', 'KhÃ´ng lÆ°u ÄÆ°á»£c mÃ£ SPX: ' + error.message);
                return;
            }
            try {
                await window.checkSpxForOrder(orderId, code, true);
            } finally {
                await window.loadOrdersFromSupabase();
            }
        }, `<div style="text-align:left;font-size:12px;color:#64748b;margin-bottom:8px">Nháº­p mÃ£ váº­n ÄÆ¡n SPX cá»§a ÄÆ¡n nÃ y.</div>
            <input type="text" id="inputSpxTrackingCode" value="${escapeHtml(currentCode)}" placeholder="VÃ­ dá»¥: SPXVN06110423690A" autocapitalize="characters">`);
    };

    window.loadOrdersFromSupabase = async function () {
        if (!currentUser) return;
        const { data: orders, error: orderError } = await _supabase.from('shopee_orders')
            .select('*').eq('user_id', currentUser.id).order('created_at', { ascending:false });
        if (orderError) { console.error('LOAD ORDERS:', orderError); return; }

        const { data: tracks, error: trackingError } = await _supabase.from('shopee_tracking')
            .select('*').eq('user_id', currentUser.id);
        if (trackingError) console.error('LOAD TRACKING:', trackingError);

        const map = new Map((tracks || []).map(t => [String(t.order_id), t]));
        cachedOrders = (orders || []).map(o => ({ ...o, tracking: map.get(String(o.id)) || null }));
        window.filterOrders();
    };

    window.extractShopeeProductName = function (lines) {
        if (!Array.isArray(lines) || !lines.length) return '';
        const hardIgnore = [
            /th[oÃ´]ng tin [Äd]Æ¡n h[aÃ ]ng/i,/th[oá»]i gian/i,/m[aÃ£]\s*[Äd]Æ¡n\s*h[aÃ ]ng/i,
            /th[aÃ ]nh\s*ti[eá»]n/i,/tá»ng\s*tiá»n/i,/thanh\s*toÃ¡n/i,/phÆ°Æ¡ng\s*thá»©c/i,
            /phÃ­\s*váº­n\s*chuyá»n/i,/mÃ£\s*giáº£m\s*giÃ¡/i,/voucher/i,/Äá»a\s*chá»\s*nháº­n\s*hÃ ng/i,
            /th[oÃ´]ng tin váº­n chuyá»n/i,/giao\s*nhanh/i,/giao\s*ÄÃºng\s*háº¹n/i,/chuáº©n\s*bá»\s*hÃ ng/i,
            /liÃªn\s*há»\s*shop/i,/xem\s*shop/i,/chat\s*ngay/i,/chat\s*vá»i/i,/trung\s*tÃ¢m\s*há»\s*trá»£/i,
            /há»§y\s*ÄÆ¡n/i,/sao\s*chÃ©p/i,/Äáº·t\s*hÃ ng\s*lÃºc/i,/hoÃ n\s*thÃ nh/i,/^\+?84/,/\(\+84\)/,
            /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/,/\bSPXVN[A-Z0-9]+\b/i
        ];
        const productWords = /\bml\b|\bkg\b|\bgram\b|\bg\b|\blÃ­t\b|\bl\b|tuá»i|lá»c|há»p|chai|gÃ³i|tÃºi|thÃ¹ng|combo|size|mÃ u|vá»|sá»¯a|bá»m|tÃ£|kem|nÆ°á»c|Ã¡o|quáº§n|giÃ y|dÃ©p|khÄn|bÃ¡nh|káº¹p|dáº§u|dÆ°á»¡ng|serum|son|pháº¥n|sáº¡c|cÃ¡p|pin|á»p|tai nghe/i;
        const shopWords = /\bshop\b|\bstore\b|official|chÃ­nh hÃ£ng|mall|flagship/i;
        const candidates = [];

        for (let i=0;i<lines.length;i++) {
            const line = String(lines[i] || '').replace(/\s+/g,' ').trim();
            if (line.length < 7 || line.length > 180) continue;
            if (hardIgnore.some(p => p.test(line))) continue;
            if (/^[A-Z0-9]{8,30}$/i.test(line) || /^[â«Ä]?\s*[\d.,]+\s*[â«Ä]?$/i.test(line) || /^x\s*\d+$/i.test(line)) continue;

            let score = 0;
            if (/[a-zA-ZÃ-á»¹]/.test(line)) score += 2;
            if (line.length >= 15) score += 2;
            if (line.length >= 25) score += 2;
            if (line.length >= 40) score += 1;
            if (productWords.test(line)) score += 7;
            if (/\d+\s*(ml|kg|g|gram|l|cm|mm|m)\b/i.test(line)) score += 5;
            if (/[a-zA-ZÃ-á»¹].*\d|\d.*[a-zA-ZÃ-á»¹]/.test(line)) score += 2;

            const next1 = String(lines[i+1] || '').trim();
            const next2 = String(lines[i+2] || '').trim();
            const prev1 = String(lines[i-1] || '').trim();
            if (/^x\s*\d+$/i.test(next1)) score += 10;
            if (/^x\s*\d+$/i.test(next2)) score += 6;
            if (/(?:â«|Ä)|\d{1,3}(?:[.,]\d{3})+/i.test(next1)) score += 3;
            if (shopWords.test(line)) score -= 12;
            if (/ngÆ°á»i\s*bÃ¡n|shop|cá»­a\s*hÃ ng/i.test(prev1)) score -= 12;
            if (line.length < 30 && !productWords.test(line) && !/\d/.test(line)) score -= 2;
            candidates.push({line,index:i,score});
        }

        if (!candidates.length) return '';
        candidates.sort((a,b) => b.score-a.score || b.line.length-a.line.length);
        const best = candidates[0];
        if (!best || best.score < 3) return '';

        let product = best.line;
        const nextLine = String(lines[best.index+1] || '').replace(/\s+/g,' ').trim();
        if (nextLine && nextLine.length <= 100) {
            const ignore = hardIgnore.some(p => p.test(nextLine));
            const money = /^[â«Ä]?\s*[\d.,]+\s*[â«Ä]?$/i.test(nextLine);
            const qty = /^x\s*\d+$/i.test(nextLine);
            const shop = shopWords.test(nextLine);
            if (!ignore && !money && !qty && !shop && /phÃ¢n\s*loáº¡i|size|mÃ u|vá»|loáº¡i|Ã­t\s*ÄÆ°á»ng|cÃ³\s*ÄÆ°á»ng|\bml\b|\bkg\b|\bg\b|lá»c|há»p|chai|gÃ³i/i.test(nextLine)) {
                if (!product.toLowerCase().includes(nextLine.toLowerCase())) product += ' ' + nextLine;
            }
        }
        return product.replace(/\s+/g,' ').trim();
    };

    window.parseShopeeOrderOCR = function (rawText) {
        const text = normalizeOcrText(rawText);
        const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
        return {
            orderCode: extractShopeeOrderCode(lines, text) || '',
            trackingCode: extractSpxTrackingCode(text) || '',
            productName: window.extractShopeeProductName(lines) || '',
            amount: extractShopeeFinalAmount(lines) || 0,
            rawText: text
        };
    };

    window.mergeShopeeOcrResults = function (inputResults) {
        const results = inputResults.map(item => ({...item}));
        const merged = [];
        for (let i=0;i<results.length;i++) {
            let current = {...results[i]};
            if (!current.orderCode && i+1 < results.length) {
                const next = results[i+1];
                if (next.orderCode) {
                    current.orderCode = next.orderCode;
                    if (!current.productName && next.productName) current.productName = next.productName;
                    if (!current.amount && next.amount) current.amount = next.amount;
                    if (!current.trackingCode && next.trackingCode) current.trackingCode = next.trackingCode;
                    current.rawText = (current.rawText || '') + '\n' + (next.rawText || '');
                    i++;
                }
            }
            if (current.orderCode && merged.length) {
                const previous = merged[merged.length-1];
                if (!previous.orderCode) {
                    if (!current.productName && previous.productName) current.productName = previous.productName;
                    if (!current.amount && previous.amount) current.amount = previous.amount;
                    if (!current.trackingCode && previous.trackingCode) current.trackingCode = previous.trackingCode;
                    merged.pop();
                }
            }
            merged.push(current);
        }
        const byCode = [];
        const codeMap = new Map();
        for (const item of merged) {
            const code = String(item.orderCode || '').trim().toUpperCase();
            if (!code) { byCode.push(item); continue; }
            if (!codeMap.has(code)) {
                const copy = {...item,orderCode:code};
                codeMap.set(code,copy); byCode.push(copy);
            } else {
                const existing = codeMap.get(code);
                if (!existing.productName && item.productName) existing.productName = item.productName;
                if (!existing.amount && item.amount) existing.amount = item.amount;
                if (!existing.trackingCode && item.trackingCode) existing.trackingCode = item.trackingCode;
            }
        }
        return byCode;
    };

    window.handleOrderImages = async function (input) {
        const files = Array.from(input.files || []);
        if (!files.length) return;
        if (orderOcrRunning) { showModal('ThÃ´ng bÃ¡o','OCR Äang xá»­ lÃ½ áº£nh. Vui lÃ²ng chá».'); return; }
        if (typeof Tesseract === 'undefined') { showModal('Lá»i OCR','KhÃ´ng táº£i ÄÆ°á»£c thÆ° viá»n OCR. HÃ£y táº£i láº¡i trang rá»i thá»­ láº¡i.'); return; }

        orderOcrRunning = true;
        const btn = document.getElementById('btnOrderOcr');
        const status = document.getElementById('ocrStatus');
        const output = document.getElementById('inputMultipleLines');
        btn.disabled = true; btn.innerText = 'â³ Äang chuáº©n bá» OCR...';
        status.style.display = 'block';
        status.innerHTML = `ð· ÄÃ£ chá»n <b>${files.length}</b> áº£nh.<br>â³ Äang chuáº©n bá» nháº­n dáº¡ng...`;
        const rawResults = [], failed = [];

        try {
            for (let i=0;i<files.length;i++) {
                const file = files[i];
                status.innerHTML = `ð· áº¢nh <b>${i+1}/${files.length}</b><br>ð Äang chuáº©n bá» áº£nh...<br><span style="color:#718096">${escapeHtml(file.name)}</span>`;
                try {
                    const image = await prepareImageForOCR(file);
                    const result = await Tesseract.recognize(image,'vie+eng',{logger:m=>{
                        if (m.status === 'recognizing text') {
                            const percent = Math.round((m.progress || 0)*100);
                            status.innerHTML = `ð Äang Äá»c áº£nh <b>${i+1}/${files.length}</b> â ${percent}%<br><span style="color:#718096">${escapeHtml(file.name)}</span>`;
                        }
                    }});
                    const rawText = result?.data?.text || '';
                    const parsed = window.parseShopeeOrderOCR(rawText);
                    parsed.fileName = file.name; parsed.imageIndex = i;
                    if (parsed.orderCode || parsed.productName || parsed.amount || parsed.trackingCode) rawResults.push(parsed);
                    else failed.push(file.name);
                } catch (e) { console.error('OCR ERROR:',file.name,e); failed.push(file.name); }
            }

            if (!rawResults.length) {
                status.innerHTML = '<span style="color:#e74c3c;font-weight:800">â KhÃ´ng nháº­n dáº¡ng ÄÆ°á»£c ÄÆ¡n hÃ ng.</span>';
                return;
            }
            const results = window.mergeShopeeOcrResults(rawResults);
            const valid = results.filter(o => !!o.orderCode);
            const incompleteCount = results.length-valid.length;
            if (!valid.length) {
                status.innerHTML = '<span style="color:#e74c3c;font-weight:800">â OCR chÆ°a tÃ¬m tháº¥y MÃ£ ÄÆ¡n hÃ ng.</span>';
                return;
            }

            const outputLines = valid.map(order => {
                const code = cleanOcrOutput(order.orderCode);
                const product = cleanOcrOutput(order.productName || 'ÄÆ¡n Shopee');
                const amount = Number(order.amount) || 0;
                const spx = isValidSpxCode(order.trackingCode) ? normalizeSpxCode(order.trackingCode) : '';
                return `${code} | | ${product} | ${amount} | ${spx}`;
            });
            const old = output.value.trim();
            output.value = old ? old+'\n'+outputLines.join('\n') : outputLines.join('\n');
            status.innerHTML = `<span style="color:#27ae60;font-weight:800">â ÄÃ£ táº¡o ${valid.length} ÄÆ¡n tá»« ${files.length} áº£nh</span>`+
                (failed.length ? `<br><span style="color:#e67e22">â ï¸ ${failed.length} áº£nh khÃ´ng Äá»c ÄÆ°á»£c.</span>` : '')+
                (incompleteCount ? `<br><span style="color:#e67e22">â ï¸ ${incompleteCount} káº¿t quáº£ thiáº¿u mÃ£ ÄÆ¡n.</span>` : '')+
                '<br><span style="color:#718096">DÃ²ng cuá»i lÃ  mÃ£ SPX náº¿u OCR tÃ¬m tháº¥y. Kiá»m tra láº¡i rá»i báº¥m Náº¡p HÃ ng Loáº¡t.</span>';
        } finally {
            orderOcrRunning = false;
            btn.disabled = false;
            btn.innerText = 'ð· Chá»n thÃªm áº£nh ÄÆ¡n hÃ ng Shopee';
            input.value = '';
        }
    };

    window.addMultipleOrders = async function (btnEl) {
        if (!currentUser) { showModal('Lá»i','Vui lÃ²ng ÄÄng nháº­p!'); return; }
        const raw = document.getElementById('inputMultipleLines').value.trim();
        if (!raw) { showModal('ThÃ´ng bÃ¡o','ChÆ°a cÃ³ dá»¯ liá»u ÄÆ¡n hÃ ng Äá» náº¡p.'); return; }

        const rows = raw.split('\n').map(x=>x.trim()).filter(Boolean).map(line => {
            const p = line.split('|').map(x=>x.trim());
            if (!p[0]) return null;
            const amount = parseInt(String(p[3] || '').replace(/\D/g,''),10) || 0;
            return {
                order:{order_code:p[0],email:p[1]||'',product_name:p[2]||'ÄÆ¡n Shopee',amount,price:amount,user_id:currentUser.id,status:'Äang chá» giao'},
                trackingCode:normalizeSpxCode(p[4] || '')
            };
        }).filter(Boolean);
        if (!rows.length) { showModal('ThÃ´ng bÃ¡o','KhÃ´ng cÃ³ dá»¯ liá»u há»£p lá» Äá» náº¡p.'); return; }
        if (btnEl) { btnEl.disabled=true; btnEl.innerText='â³ Äang náº¡p hÃ ng loáº¡t...'; }

        let inserted=0, trackingSaved=0;
        try {
            for (let i=0;i<rows.length;i+=50) {
                const chunk=rows.slice(i,i+50);
                const {data,error}=await _supabase.from('shopee_orders').insert(chunk.map(x=>x.order)).select('id,order_code');
                if (error) throw error;
                inserted += (data || []).length;
                const codeMap = new Map(chunk.map(x=>[String(x.order.order_code).toUpperCase(),x.trackingCode]));
                const trackingRows = (data || []).map(o=>{
                    const tc=codeMap.get(String(o.order_code).toUpperCase()) || '';
                    return isValidSpxCode(tc) ? {order_id:Number(o.id),user_id:currentUser.id,tracking_code:tc,updated_at:new Date().toISOString()} : null;
                }).filter(Boolean);
                if (trackingRows.length) {
                    const {error:te}=await _supabase.from('shopee_tracking').upsert(trackingRows,{onConflict:'order_id'});
                    if (te) throw te;
                    trackingSaved += trackingRows.length;
                }
            }
            document.getElementById('inputMultipleLines').value='';
            await window.loadOrdersFromSupabase();
            showModal('ThÃ nh cÃ´ng',`ÄÃ£ náº¡p ${inserted} ÄÆ¡n. ÄÃ£ lÆ°u ${trackingSaved} mÃ£ SPX.`);
        } catch(e) {
            showModal('Lá»i','Náº¡p dá»¯ liá»u tháº¥t báº¡i: '+(e.message || e));
        } finally {
            if (btnEl) { btnEl.disabled=false; btnEl.innerText='Náº¡p HÃ ng Loáº¡t'; }
        }
    };

    window.filterOrders = function (resetPage=false) {
        if (resetPage) currentOrderPage=1;
        const searchInput=document.getElementById('searchOrderInput');
        const keyword=searchInput ? searchInput.value.toLowerCase().trim() : '';
        const filtered=cachedOrders.filter(o=>{
            const code=String(o.order_code||'').toLowerCase();
            const product=String(o.product_name||'').toLowerCase();
            const trackingCode=String(o.tracking?.tracking_code||'').toLowerCase();
            const trackingStatus=String(o.tracking?.tracking_status||'').toLowerCase();
            const matchesSearch=!keyword || code.includes(keyword) || product.includes(keyword) || trackingCode.includes(keyword) || trackingStatus.includes(keyword);
            const isSuccess=o.status==='ÄÃ£ giao' || o.status==='ÄÃ£ giao thÃ nh cÃ´ng' || (o.status && o.status.includes('ÄÃ£ giao'));
            let matchesTab=true;
            if(currentOrderTab==='completed') matchesTab=isSuccess;
            else if(currentOrderTab==='pending') matchesTab=!isSuccess;
            return matchesSearch && matchesTab;
        });
        window.renderOrders(filtered);
    };

    const originalRenderOrders = window.renderOrders;
    window.renderOrders = function (ordersToRender) {
        originalRenderOrders(ordersToRender);
        if (!ordersToRender || !ordersToRender.length) return;
        const totalPages=Math.ceil(ordersToRender.length/ordersPerPage);
        if(currentOrderPage>totalPages) currentOrderPage=totalPages;
        if(currentOrderPage<1) currentOrderPage=1;
        const startIdx=(currentOrderPage-1)*ordersPerPage;
        const visible=ordersToRender.slice(startIdx,startIdx+ordersPerPage);
        const cards=document.querySelectorAll('#orderListContainer .order-card');

        cards.forEach((card,index)=>{
            const order=visible[index];
            if(!order) return;
            const t=order.tracking || null;
            const code=String(t?.tracking_code || '');
            const details=card.querySelector('.order-details-grid');
            if(details) {
                const box=document.createElement('div');
                box.className='order-item-row nk-spx-row';
                box.innerHTML=code
                    ? `ð <b>SPX:</b> <span style="color:#2563eb;font-weight:800">${escapeHtml(code)}</span>`
                    : 'ð <b>SPX:</b> <span style="color:#999">ChÆ°a cÃ³ mÃ£</span>';
                details.appendChild(box);
                if(t?.tracking_status) {
                    const s=document.createElement('div'); s.className='order-item-row';
                    s.innerHTML=`ð <b>Váº­n chuyá»n:</b> ${escapeHtml(t.tracking_status)}`; details.appendChild(s);
                }
                if(t?.next_location) {
                    const n=document.createElement('div'); n.className='order-item-row';
                    n.innerHTML=`â¡ï¸ <b>Äiá»m tiáº¿p:</b> ${escapeHtml(t.next_location)}`; details.appendChild(n);
                }
            }
            const actions=card.querySelector('.order-actions');
            if(actions) {
                actions.style.flexWrap='wrap';
                Array.from(actions.children).forEach(b=>{b.style.minWidth='calc(50% - 4px)';});
                const spxBtn=document.createElement('button');
                spxBtn.className='order-btn-check'; spxBtn.style.background='#7c3aed';
                spxBtn.style.minWidth='calc(50% - 4px)'; spxBtn.textContent=code ? 'ð Check SPX' : 'â ThÃªm SPX';
                spxBtn.onclick=()=>window.openSpxTracking(Number(order.id),code);
                actions.appendChild(spxBtn);
            }
        });
    };

    window.checkAllSpxOrders = async function (btnEl) {
        if(!currentUser){showModal('Lá»i','Vui lÃ²ng ÄÄng nháº­p!');return;}
        const targets=cachedOrders.filter(o=>o.tracking?.tracking_code && !o.tracking?.delivered);
        if(!targets.length){showModal('SPX','KhÃ´ng cÃ³ ÄÆ¡n SPX nÃ o cáº§n quÃ©t.');return;}
        if(btnEl){btnEl.disabled=true;btnEl.innerText='â³ Äang quÃ©t SPX...';}
        let ok=0,delivered=0,fail=0;
        try {
            for(let i=0;i<targets.length;i++){
                const o=targets[i];
                if(btnEl) btnEl.innerText=`â³ SPX ${i+1}/${targets.length}`;
                try {
                    const data=await window.checkSpxForOrder(o.id,o.tracking.tracking_code,false);
                    ok++; if(data?.delivered) delivered++;
                } catch(e){fail++; console.error('SPX BULK:',e);}
                if(i<targets.length-1) await new Promise(r=>setTimeout(r,1000));
            }
            await window.loadOrdersFromSupabase();
            showModal('QuÃ©t SPX xong',`ÄÃ£ kiá»m tra ${ok}/${targets.length} mÃ£ SPX.\nÄÃ£ giao: ${delivered}.\nLá»i: ${fail}.`);
        } finally {
            if(btnEl){btnEl.disabled=false;btnEl.innerText='ð QuÃ©t Tráº¡ng ThÃ¡i SPX';}
        }
    };

    function installUi() {
        const bulk=document.getElementById('btnCheckAllOrders');
        if(bulk && !document.getElementById('btnCheckAllSpxOrders')) {
            const b=document.createElement('button');
            b.id='btnCheckAllSpxOrders'; b.className='btn-main'; b.style.backgroundColor='#7c3aed';
            b.textContent='ð QuÃ©t Tráº¡ng ThÃ¡i SPX'; b.onclick=()=>window.checkAllSpxOrders(b);
            bulk.insertAdjacentElement('afterend',b);
        }
        const area=document.querySelector('#depositMultipleForm .ocr-desc');
        if(area) area.innerHTML='Chá»n má»t hoáº·c nhiá»u áº£nh. Há» thá»ng sáº½ Äá»c MÃ£ ÄÆ¡n hÃ ng, TÃªn sáº£n pháº©m, ThÃ nh tiá»n vÃ  mÃ£ SPXVN náº¿u cÃ³. Email khÃ´ng cÃ³ trong áº£nh sáº½ Äá» trá»ng. Báº¡n cÃ³ thá» sá»­a káº¿t quáº£ trÆ°á»c khi náº¡p.';
        const ta=document.getElementById('inputMultipleLines');
        if(ta) ta.placeholder='MÃ£ ÄÆ¡n | Email | TÃªn SP | Sá» tiá»n | MÃ£ SPX (náº¿u cÃ³)';
    }

    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installUi);
    else installUi();

    /* Refresh once so existing rows immediately receive tracking data/UI. */
    setTimeout(()=>{ if(window.currentUser || typeof currentUser!=='undefined' && currentUser) window.loadOrdersFromSupabase(); },300);
})();
