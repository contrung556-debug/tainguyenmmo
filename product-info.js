// /api/product-info.js
// Lấy thông tin sản phẩm từ endpoint Shopee theo shop_id + item_id.
// Không dùng cookie đăng nhập, không vượt CAPTCHA/chống bot.

function parseIds(input) {
  const s = String(input || "").trim();
  let m = s.match(/\/product\/(\d+)\/(\d+)/i);
  if (m) return { shopid: m[1], itemid: m[2] };
  m = s.match(/-i\.(\d+)\.(\d+)/i);
  if (m) return { shopid: m[1], itemid: m[2] };
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  try {
    const ids = parseIds(req.query?.url);
    if (!ids) return res.status(400).json({ success:false, error:"Link Shopee không hợp lệ" });

    const endpoint =
      `https://shopee.vn/api/v4/item/get?itemid=${encodeURIComponent(ids.itemid)}` +
      `&shopid=${encodeURIComponent(ids.shopid)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let r;
    try {
      r = await fetch(endpoint, {
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "Mozilla/5.0"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) {
      return res.status(502).json({
        success:false,
        error:"Shopee tạm thời không trả dữ liệu",
        upstreamStatus:r.status
      });
    }

    const j = await r.json();
    const d = j?.data;
    if (!d) return res.status(502).json({ success:false, error:"Không có dữ liệu sản phẩm" });

    // Shopee thường trả giá theo đơn vị 1/100000 VNĐ ở endpoint storefront.
    const raw = d.price_min ?? d.price ?? null;
    const price = raw == null ? null : Math.round(Number(raw) / 100000);

    let image = d.image || (Array.isArray(d.images) ? d.images[0] : "");
    if (image && !/^https?:\/\//i.test(image)) image = `https://cf.shopee.vn/file/${image}`;

    return res.status(200).json({
      success:true,
      shopId:String(ids.shopid),
      itemId:String(ids.itemid),
      name:d.name || "",
      price,
      priceMin:d.price_min == null ? null : Math.round(Number(d.price_min)/100000),
      priceMax:d.price_max == null ? null : Math.round(Number(d.price_max)/100000),
      image,
      stock:d.stock ?? null,
      sold:d.historical_sold ?? d.sold ?? null
    });
  } catch (e) {
    if (e?.name === "AbortError")
      return res.status(504).json({ success:false, error:"Shopee phản hồi quá lâu" });
    return res.status(500).json({ success:false, error:e?.message || "Lỗi server" });
  }
}
