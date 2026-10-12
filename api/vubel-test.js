export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Chỉ hỗ trợ POST"
    });
  }

  const apiKey = process.env.VUBEL_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "Vercel chưa đọc được VUBEL_API_KEY"
    });
  }

  const spc_st = String(req.body?.spc_st || "")
    .replace(/^SPC_ST=/i, "")
    .trim();

  if (!spc_st) {
    return res.status(400).json({
      ok: false,
      error: "Thiếu SPC_ST"
    });
  }

  try {
    const r = await fetch(
      "https://api.vubel.store/v1/shopee/get_order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Cookie": `SPC_ST=${spc_st}`
        },
        body: JSON.stringify({
          proxy: ""
        })
      }
    );

    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return res.status(r.status).json({
      ok: r.ok,
      vubel_status: r.status,
      data
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Không kết nối được Vubel",
      detail: String(err?.message || err)
    });
  }
}
