export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // =========================================================
  // GET -> TRANG TEST
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

  <title>Test Vubel / Shopee</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 20px 16px;
      font-family: -apple-system, BlinkMacSystemFont,
                   "Segoe UI", sans-serif;
      background: #f5f6f8;
      color: #222;
    }

    .box {
      max-width: 600px;
      margin: 20px auto;
      background: #fff;
      border-radius: 20px;
      padding: 22px;
      box-shadow: 0 8px 30px rgba(0,0,0,.08);
    }

    h1 {
      margin: 0 0 8px;
      font-size: 25px;
    }

    .sub {
      color: #777;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    label {
      display: block;
      font-weight: 700;
      margin: 18px 0 8px;
    }

    textarea,
    input {
      width: 100%;
      border: 1px solid #ddd;
      border-radius: 12px;
      padding: 14px;
      font-size: 16px;
      outline: none;
      background: #fff;
    }

    textarea {
      min-height: 135px;
      resize: vertical;
      word-break: break-all;
    }

    textarea:focus,
    input:focus {
      border-color: #ee4d2d;
    }

    .hint {
      margin-top: 7px;
      color: #888;
      font-size: 12px;
      line-height: 1.5;
    }

    button {
      width: 100%;
      margin-top: 22px;
      padding: 16px;
      border: 0;
      border-radius: 13px;
      background: #ee4d2d;
      color: #fff;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
    }

    button:disabled {
      opacity: .6;
    }

    .status {
      margin-top: 22px;
      font-size: 17px;
      font-weight: 700;
    }

    pre {
      margin-top: 12px;
      padding: 15px;
      min-height: 100px;
      max-height: 500px;
      overflow: auto;
      border-radius: 13px;
      background: #111;
      color: #eee;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .security {
      margin-top: 15px;
      padding: 12px;
      border-radius: 10px;
      background: #f7f7f7;
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
    Test lấy đơn hàng Shopee qua Vubel API
  </div>

  <label>SPC_ST</label>

  <textarea
    id="cookie"
    autocomplete="off"
    placeholder="Dán SPC_ST=... hoặc chỉ giá trị cookie"></textarea>

  <label>Proxy</label>

  <input
    id="proxy"
    type="text"
    autocomplete="off"
    autocapitalize="none"
    placeholder="http://ip:port">

  <div class="hint">
    Hỗ trợ:<br>
    http://ip:port<br>
    http://user:pass@ip:port
  </div>

  <button id="btn" onclick="testAPI()">
    TEST API
  </button>

  <div id="status" class="status">
    Chưa test
  </div>

  <pre id="result">Kết quả sẽ hiện ở đây...</pre>

  <div class="security">
    SPC_ST và proxy không được lưu vào localStorage.
    VUBEL_API_KEY vẫn nằm trên Vercel và không được gửi xuống trình duyệt.
  </div>

</div>

<script>

async function testAPI() {

  const cookieInput =
    document.getElementById("cookie");

  const proxyInput =
    document.getElementById("proxy");

  const btn =
    document.getElementById("btn");

  const status =
    document.getElementById("status");

  const result =
    document.getElementById("result");


  let spc_st =
    cookieInput.value.trim();

  let proxy =
    proxyInput.value.trim();


  // Cho phép dán SPC_ST=xxxx
  spc_st = spc_st
    .replace(/^SPC_ST=/i, "")
    .trim();


  if (!spc_st) {
    alert("Bạn chưa nhập SPC_ST");
    return;
  }


  if (!proxy) {
    alert("Bạn chưa nhập Proxy");
    return;
  }


  if (
    !proxy.startsWith("http://") &&
    !proxy.startsWith("https://")
  ) {
    alert(
      "Proxy phải bắt đầu bằng http:// hoặc https://"
    );
    return;
  }


  btn.disabled = true;
  btn.innerText = "ĐANG TEST...";

  status.innerText =
    "⏳ Đang gọi Vubel...";

  result.textContent = "";


  try {

    const response =
      await fetch(window.location.pathname, {

        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          spc_st: spc_st,
          proxy: proxy
        })

      });


    const text =
      await response.text();


    let data;

    try {

      data = JSON.parse(text);

    } catch {

      data = {
        raw: text
      };

    }


    if (response.ok) {

      status.innerText =
        "✅ Vubel phản hồi thành công";

    } else {

      status.innerText =
        "❌ API trả HTTP " +
        response.status;

    }


    result.textContent =
      JSON.stringify(
        data,
        null,
        2
      );


  } catch (error) {

    status.innerText =
      "❌ Không gọi được API";

    result.textContent =
      String(error);

  } finally {

    btn.disabled = false;

    btn.innerText =
      "TEST API";

  }
}

</script>

</body>
</html>
    `);
  }


  // =========================================================
  // POST
  // =========================================================

  if (req.method !== "POST") {

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });

  }


  // =========================================================
  // VUBEL API KEY
  // =========================================================

  const apiKey =
    process.env.VUBEL_API_KEY;


  if (!apiKey) {

    return res.status(500).json({
      ok: false,
      error: "Không tìm thấy VUBEL_API_KEY trên Vercel"
    });

  }


  // =========================================================
  // INPUT
  // =========================================================

  let spc_st =
    String(req.body?.spc_st || "")
      .trim();

  let proxy =
    String(req.body?.proxy || "")
      .trim();


  spc_st = spc_st
    .replace(/^SPC_ST=/i, "")
    .trim();


  if (!spc_st) {

    return res.status(400).json({
      ok: false,
      error: "Thiếu SPC_ST"
    });

  }


  if (!proxy) {

    return res.status(400).json({
      ok: false,
      error: "Thiếu proxy"
    });

  }


  // =========================================================
  // CALL VUBEL
  // =========================================================

  try {

    const response =
      await fetch(
        "https://api.vubel.store/v1/shopee/get_order",
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "x-api-key":
              apiKey,

            "Cookie":
              "SPC_ST=" + spc_st
          },


          body: JSON.stringify({
            proxy: proxy
          })

        }
      );


    const raw =
      await response.text();


    let data;

    try {

      data =
        JSON.parse(raw);

    } catch {

      data = {
        raw: raw
      };

    }


    return res
      .status(response.status)
      .json({

        ok: response.ok,

        vubel_status:
          response.status,

        data: data

      });


  } catch (error) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Không kết nối được Vubel",

        detail:
          String(
            error?.message ||
            error
          )

      });

  }
}
