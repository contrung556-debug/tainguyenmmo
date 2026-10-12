export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // =========================================================
  // GET -> HIỆN GIAO DIỆN TEST
  // =========================================================
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(`
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport"
        content="width=device-width, initial-scale=1.0, viewport-fit=cover">

  <title>Test Vubel API</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 24px 16px;
      font-family: -apple-system, BlinkMacSystemFont,
                   "Segoe UI", sans-serif;
      background: #f5f6f8;
      color: #222;
    }

    .box {
      width: 100%;
      max-width: 560px;
      margin: 40px auto;
      background: white;
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 8px 30px rgba(0,0,0,.08);
    }

    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }

    .sub {
      color: #777;
      font-size: 14px;
      margin-bottom: 22px;
    }

    label {
      display: block;
      font-weight: 600;
      margin-bottom: 8px;
    }

    textarea {
      width: 100%;
      min-height: 150px;
      padding: 14px;
      border: 1px solid #ddd;
      border-radius: 12px;
      resize: vertical;
      font-size: 14px;
      outline: none;
    }

    textarea:focus {
      border-color: #ee4d2d;
    }

    button {
      width: 100%;
      margin-top: 14px;
      padding: 15px;
      border: 0;
      border-radius: 12px;
      background: #ee4d2d;
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }

    button:disabled {
      opacity: .6;
    }

    .status {
      margin-top: 20px;
      font-weight: 600;
    }

    pre {
      margin-top: 10px;
      padding: 14px;
      background: #111;
      color: #eee;
      border-radius: 12px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 80px;
      font-size: 12px;
    }

    .note {
      margin-top: 14px;
      color: #777;
      font-size: 12px;
      line-height: 1.5;
    }
  </style>
</head>

<body>

<div class="box">

  <h1>🧪 Test Vubel / Shopee</h1>

  <div class="sub">
    Kiểm tra API lấy đơn hàng bằng SPC_ST
  </div>

  <label>SPC_ST</label>

  <textarea
    id="cookie"
    placeholder="Dán SPC_ST hoặc SPC_ST=... vào đây"></textarea>

  <button id="btn" onclick="testAPI()">
    TEST API
  </button>

  <div class="status" id="status">
    Chưa test
  </div>

  <pre id="result">Kết quả sẽ hiện ở đây...</pre>

  <div class="note">
    Cookie chỉ được gửi tới endpoint test này để thực hiện yêu cầu.
    Trang test không lưu cookie vào localStorage.
  </div>

</div>

<script>
async function testAPI() {

  const btn = document.getElementById("btn");
  const status = document.getElementById("status");
  const result = document.getElementById("result");

  let cookie = document
    .getElementById("cookie")
    .value
    .trim();

  if (!cookie) {
    alert("Bạn chưa nhập SPC_ST");
    return;
  }

  // Cho phép dán cả SPC_ST=xxxx
  cookie = cookie.replace(/^SPC_ST=/i, "").trim();

  btn.disabled = true;
  btn.innerText = "ĐANG TEST...";

  status.innerText = "⏳ Đang gọi Vubel...";
  result.textContent = "";

  try {

    const response = await fetch(window.location.pathname, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        spc_st: cookie
      })
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text
      };
    }

    status.innerText =
      response.ok
        ? "✅ API phản hồi thành công"
        : "❌ API trả lỗi HTTP " + response.status;

    result.textContent =
      JSON.stringify(data, null, 2);

  } catch (error) {

    status.innerText = "❌ Không gọi được API";

    result.textContent =
      String(error);

  } finally {

    btn.disabled = false;
    btn.innerText = "TEST API";

  }
}
</script>

</body>
</html>
    `);
  }


  // =========================================================
  // CHỈ CHẤP NHẬN POST
  // =========================================================
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }


  // =========================================================
  // LẤY VUBEL API KEY TỪ VERCEL
  // =========================================================
  const apiKey = process.env.VUBEL_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "Không tìm thấy VUBEL_API_KEY trên Vercel"
    });
  }


  // =========================================================
  // NHẬN SPC_ST
  // =========================================================
  let spc_st = String(
    req.body?.spc_st || ""
  ).trim();

  spc_st = spc_st
    .replace(/^SPC_ST=/i, "")
    .trim();

  if (!spc_st) {
    return res.status(400).json({
      ok: false,
      error: "Thiếu SPC_ST"
    });
  }


  // =========================================================
  // GỌI VUBEL
  // =========================================================
  try {

    const response = await fetch(
      "https://api.vubel.store/v1/shopee/get_order",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Cookie": "SPC_ST=" + spc_st
        },

        // TEST KHÔNG PROXY TRƯỚC
        body: JSON.stringify({
          proxy: ""
        })
      }
    );


    // =======================================================
    // ĐỌC RESPONSE
    // =======================================================
    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        raw: raw
      };
    }


    // =======================================================
    // TRẢ KẾT QUẢ
    // =======================================================
    return res.status(response.status).json({

      ok: response.ok,

      vubel_status: response.status,

      data: data

    });


  } catch (error) {

    return res.status(500).json({

      ok: false,

      error: "Không kết nối được Vubel",

      detail: String(
        error?.message || error
      )

    });

  }
}
