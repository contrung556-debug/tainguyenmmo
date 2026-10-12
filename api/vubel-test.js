export default async function handler(req, res) {
  // ============================================================
  // VUBEL / SHOPEE TEST
  // ============================================================

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  // ============================================================
  // GET -> HIỆN TRANG TEST
  // ============================================================

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(`
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, viewport-fit=cover"
  >

  <title>Test Vubel / Shopee</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 20px 16px 50px;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      background: #f4f5f7;
      color: #222;
    }

    .box {
      width: 100%;
      max-width: 620px;

      margin: 20px auto;

      padding: 24px;

      background: #fff;

      border-radius: 22px;

      box-shadow:
        0 8px 30px
        rgba(0, 0, 0, 0.07);
    }

    h1 {
      margin: 0 0 8px;

      font-size: 27px;
      line-height: 1.25;
    }

    .sub {
      margin-bottom: 25px;

      color: #777;

      font-size: 15px;
      line-height: 1.5;
    }

    label {
      display: block;

      margin: 19px 0 8px;

      font-size: 16px;
      font-weight: 700;
    }

    textarea,
    input {
      width: 100%;

      padding: 14px;

      border: 1px solid #ddd;
      border-radius: 13px;

      outline: none;

      background: #fff;

      font-size: 16px;

      transition: border-color .2s;
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
      margin-top: 8px;

      color: #888;

      font-size: 12px;
      line-height: 1.6;
    }

    .warning {
      margin-top: 18px;

      padding: 12px 14px;

      border-radius: 12px;

      background: #fff8e6;

      color: #795d13;

      font-size: 13px;
      line-height: 1.5;
    }

    button {
      width: 100%;

      margin-top: 22px;

      padding: 16px;

      border: none;
      border-radius: 14px;

      background: #ee4d2d;

      color: #fff;

      font-size: 17px;
      font-weight: 700;

      cursor: pointer;
    }

    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }

    .status {
      margin-top: 23px;

      padding: 13px 14px;

      border-radius: 12px;

      background: #f6f6f6;

      font-size: 16px;
      font-weight: 700;

      line-height: 1.45;
    }

    .status.success {
      background: #ecf9f0;
      color: #18763a;
    }

    .status.error {
      background: #fff0ed;
      color: #c7381c;
    }

    .status.loading {
      background: #fff8e6;
      color: #856404;
    }

    pre {
      margin-top: 12px;

      min-height: 110px;
      max-height: 550px;

      padding: 15px;

      overflow: auto;

      border-radius: 14px;

      background: #111;

      color: #eee;

      font-size: 12px;
      line-height: 1.55;

      white-space: pre-wrap;
      word-break: break-word;
    }

    .security {
      margin-top: 16px;

      padding: 13px;

      border-radius: 12px;

      background: #f7f7f7;

      color: #777;

      font-size: 12px;
      line-height: 1.55;
    }
  </style>
</head>

<body>

  <div class="box">

    <h1>🧪 Test Vubel / Shopee</h1>

    <div class="sub">
      Kiểm tra API lấy đơn hàng Shopee qua Vubel.
    </div>


    <!-- SPC_ST -->

    <label for="cookie">
      SPC_ST
    </label>

    <textarea
      id="cookie"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      placeholder="Dán SPC_ST=... hoặc chỉ giá trị SPC_ST"
    ></textarea>


    <!-- PROXY -->

    <label for="proxy">
      Proxy
    </label>

    <input
      id="proxy"
      type="text"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      placeholder="http://ip:port"
    >


    <div class="hint">
      Định dạng:<br>
      http://ip:port<br>
      http://user:pass@ip:port
    </div>


    <div class="warning">
      ⚠️ Không nên sử dụng proxy công cộng với cookie
      của tài khoản thật. Nên dùng proxy riêng mà bạn tin cậy.
    </div>


    <!-- BUTTON -->

    <button
      id="btn"
      type="button"
      onclick="testVubel()"
    >
      TEST VUBEL API
    </button>


    <!-- STATUS -->

    <div
      id="status"
      class="status"
    >
      Chưa test
    </div>


    <!-- RESULT -->

    <pre id="result">Kết quả sẽ hiện ở đây...</pre>


    <div class="security">
      🔐 VUBEL_API_KEY được đọc trực tiếp từ
      Vercel Environment Variables.

      SPC_ST và Proxy không được lưu vào
      localStorage/sessionStorage bởi trang test này.
    </div>

  </div>


<script>

  // ============================================================
  // UI STATUS
  // ============================================================

  function setStatus(type, text) {

    const el =
      document.getElementById("status");

    el.className =
      "status " + (type || "");

    el.textContent =
      text;
  }


  // ============================================================
  // TEST
  // ============================================================

  async function testVubel() {

    const cookieInput =
      document.getElementById("cookie");

    const proxyInput =
      document.getElementById("proxy");

    const button =
      document.getElementById("btn");

    const result =
      document.getElementById("result");


    let spc_st =
      cookieInput.value.trim();

    let proxy =
      proxyInput.value.trim();


    // Cho phép dán nguyên:
    // SPC_ST=xxxx

    spc_st =
      spc_st
        .replace(/^SPC_ST=/i, "")
        .trim();


    // ==========================================================
    // VALIDATE
    // ==========================================================

    if (!spc_st) {

      setStatus(
        "error",
        "❌ Bạn chưa nhập SPC_ST"
      );

      return;
    }


    if (!proxy) {

      setStatus(
        "error",
        "❌ Bạn chưa nhập Proxy"
      );

      return;
    }


    if (
      !proxy.startsWith("http://") &&
      !proxy.startsWith("https://")
    ) {

      setStatus(
        "error",
        "❌ Proxy phải bắt đầu bằng http:// hoặc https://"
      );

      return;
    }


    // ==========================================================
    // LOADING
    // ==========================================================

    button.disabled = true;

    button.textContent =
      "ĐANG TEST...";


    setStatus(
      "loading",
      "⏳ Đang kết nối Vubel..."
    );


    result.textContent =
      "Đang chờ phản hồi...";


    // ==========================================================
    // REQUEST
    // ==========================================================

    try {

      const response =
        await fetch(
          window.location.pathname,
          {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({

              spc_st:
                spc_st,

              proxy:
                proxy

            })

          }
        );


      const text =
        await response.text();


      let data;


      try {

        data =
          JSON.parse(text);

      } catch {

        data = {
          ok: false,
          message:
            "Server trả dữ liệu không phải JSON."
        };

      }


      // ========================================================
      // STATUS MESSAGE
      // ========================================================

      if (response.ok && data.ok) {

        setStatus(
          "success",
          "✅ Vubel phản hồi thành công"
        );

      }

      else if (
        data.type ===
        "VUBEL_BAD_GATEWAY"
      ) {

        setStatus(
          "error",
          "⚠️ Vubel / upstream đang lỗi 502"
        );

      }

      else if (
        response.status === 400
      ) {

        setStatus(
          "error",
          "❌ Request không hợp lệ (HTTP 400)"
        );

      }

      else if (
        response.status === 401 ||
        response.status === 403
      ) {

        setStatus(
          "error",
          "❌ API key / xác thực bị từ chối"
        );

      }

      else {

        setStatus(
          "error",
          "❌ API trả HTTP " +
          response.status
        );

      }


      result.textContent =
        JSON.stringify(
          data,
          null,
          2
        );


    } catch (error) {

      setStatus(
        "error",
        "❌ Không kết nối được endpoint Vercel"
      );


      result.textContent =
        JSON.stringify(
          {
            ok: false,

            error:
              String(
                error?.message ||
                error
              )
          },

          null,
          2
        );

    }

    finally {

      button.disabled =
        false;

      button.textContent =
        "TEST VUBEL API";

    }

  }

</script>

</body>
</html>
    `);
  }


  // ============================================================
  // CHỈ CHẤP NHẬN POST
  // ============================================================

  if (req.method !== "POST") {

    return res.status(405).json({

      ok: false,

      type:
        "METHOD_NOT_ALLOWED",

      message:
        "Chỉ hỗ trợ GET và POST"

    });

  }


  // ============================================================
  // API KEY TỪ VERCEL
  // ============================================================

  const apiKey =
    process.env.VUBEL_API_KEY;


  if (!apiKey) {

    return res.status(500).json({

      ok: false,

      type:
        "MISSING_API_KEY",

      message:
        "Vercel chưa có VUBEL_API_KEY"

    });

  }


  // ============================================================
  // INPUT
  // ============================================================

  let spc_st =
    String(
      req.body?.spc_st || ""
    ).trim();


  let proxy =
    String(
      req.body?.proxy || ""
    ).trim();


  spc_st =
    spc_st
      .replace(/^SPC_ST=/i, "")
      .trim();


  // ============================================================
  // VALIDATE SPC_ST
  // ============================================================

  if (!spc_st) {

    return res.status(400).json({

      ok: false,

      type:
        "MISSING_SPC_ST",

      message:
        "Thiếu SPC_ST"

    });

  }


  // ============================================================
  // VALIDATE PROXY
  // ============================================================

  if (!proxy) {

    return res.status(400).json({

      ok: false,

      type:
        "MISSING_PROXY",

      message:
        "Thiếu Proxy"

    });

  }


  if (
    !proxy.startsWith("http://") &&
    !proxy.startsWith("https://")
  ) {

    return res.status(400).json({

      ok: false,

      type:
        "INVALID_PROXY",

      message:
        "Proxy phải bắt đầu bằng http:// hoặc https://"

    });

  }


  // ============================================================
  // CALL VUBEL
  // ============================================================

  try {

    const response =
      await fetch(
        "https://api.vubel.store/v1/shopee/get_order",
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Accept":
              "application/json",

            "x-api-key":
              apiKey,

            "Cookie":
              "SPC_ST=" + spc_st

          },

          body:
            JSON.stringify({

              proxy:
                proxy

            })

        }
      );


    // ==========================================================
    // READ RESPONSE
    // ==========================================================

    const raw =
      await response.text();


    let data =
      null;


    try {

      data =
        JSON.parse(raw);

    } catch {

      data =
        null;

    }


    // ==========================================================
    // CLOUDFLARE / VUBEL 502
    // ==========================================================

    if (response.status === 502) {

      return res.status(502).json({

        ok: false,

        type:
          "VUBEL_BAD_GATEWAY",

        message:
          "Vubel hoặc upstream/proxy trả lỗi 502 Bad Gateway. Hãy thử lại hoặc kiểm tra proxy."

      });

    }


    // ==========================================================
    // 401 / 403
    // ==========================================================

    if (
      response.status === 401 ||
      response.status === 403
    ) {

      return res
        .status(response.status)
        .json({

          ok: false,

          type:
            data?.error ||
            "AUTH_FAILED",

          message:
            data?.message ||
            "Vubel từ chối xác thực.",

          data:
            data

        });

    }


    // ==========================================================
    // OTHER ERRORS
    // ==========================================================

    if (!response.ok) {

      return res
        .status(response.status)
        .json({

          ok: false,

          type:
            data?.error ||
            "VUBEL_ERROR",

          message:
            data?.message ||
            (
              "Vubel trả HTTP " +
              response.status
            ),

          data:
            data

        });

    }


    // ==========================================================
    // SUCCESS
    // ==========================================================

    return res.status(200).json({

      ok: true,

      message:
        "Vubel phản hồi thành công",

      data:
        data ?? {
          raw:
            raw
        }

    });

  }

  catch (error) {

    // ==========================================================
    // NETWORK ERROR
    // ==========================================================

    return res.status(500).json({

      ok: false,

      type:
        "NETWORK_ERROR",

      message:
        "Vercel không kết nối được tới Vubel.",

      detail:
        String(
          error?.message ||
          error
        )

    });

  }

}
