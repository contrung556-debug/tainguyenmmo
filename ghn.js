// /api/ghn.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { trackingNumber, phoneLast4 } = req.body || {};

    const tracking = String(trackingNumber || "").trim().toUpperCase();
    const phone4 = String(phoneLast4 || "").replace(/\D/g, "");

    if (!tracking) {
      return res.status(400).json({
        success: false,
        error: "Thiếu mã vận đơn"
      });
    }

    if (!/^\d{4}$/.test(phone4)) {
      return res.status(400).json({
        success: false,
        error: "phoneLast4 phải gồm đúng 4 số"
      });
    }

    const response = await fetch("https://tradon.vn/api/tracking/ghn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        trackingNumber: tracking,
        phoneLast4: phone4
      })
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        error: "TraDon trả dữ liệu không phải JSON",
        upstreamStatus: response.status
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "Tra cứu GHN thất bại",
        upstreamStatus: response.status,
        upstream: data
      });
    }

    // Trả nguyên kết quả để test trước
    return res.status(200).json(data);

  } catch (error) {
    console.error("GHN API error:", error);

    return res.status(500).json({
      success: false,
      error: "Lỗi server",
      message: error?.message || "Unknown error"
    });
  }
}
