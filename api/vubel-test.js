// ============================================================
// api/vubel-test.js
// VUBEL TEST CONSOLE
//
// Test:
// 1. Shopee Info
// 2. Get Order
// 3. Address List
// 4. Add Mail - email tự có
//
// VUBEL_API_KEY:
// Vercel -> Settings -> Environment Variables
// ============================================================

const VUBEL_BASE = "https://api.vubel.store";

export default async function handler(req, res) {

  // ==========================================================
  // GET - GIAO DIỆN TEST
  // ==========================================================

  if (req.method === "GET") {

    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    return res.status(200).send(`<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Vubel API Test</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;

  background: #f4f6f8;
  color: #202124;
}


/* ================= HEADER ================= */

.header {
  background:
    linear-gradient(
      135deg,
      #ee4d2d,
      #ff7337
    );

  color: white;
  padding: 25px 16px 35px;
}

.header-inner {
  max-width: 760px;
  margin: auto;
}

.header h1 {
  margin: 0 0 5px;
  font-size: 25px;
}

.header p {
  margin: 0;
  font-size: 13px;
  opacity: .9;
}


/* ================= LAYOUT ================= */

.container {
  max-width: 760px;
  margin: -15px auto 40px;
  padding: 0 13px;
}

.card {
  background: white;
  border-radius: 16px;

  padding: 18px;
  margin-bottom: 14px;

  box-shadow:
    0 5px 20px rgba(0,0,0,.06);
}

.card h2 {
  margin: 0 0 15px;
  font-size: 17px;
}

.subtitle {
  color: #777;
  font-size: 12px;
  margin-top: -7px;
  margin-bottom: 15px;
}


/* ================= INPUT ================= */

label {
  display: block;

  margin-top: 13px;
  margin-bottom: 6px;

  font-size: 13px;
  font-weight: 650;
}

input,
textarea {

  width: 100%;

  border:
    1px solid #dfe3e8;

  border-radius: 11px;

  padding: 12px;

  font-size: 14px;

  background: white;

  outline: none;
}

textarea {
  min-height: 90px;
  resize: vertical;
}

input:focus,
textarea:focus {

  border-color: #ee4d2d;

  box-shadow:
    0 0 0 3px
    rgba(238,77,45,.08);
}


/* ================= INFO ================= */

.note {

  margin-top: 12px;

  background: #fff8e8;

  border:
    1px solid #ffe0a3;

  border-radius: 10px;

  padding: 10px 12px;

  font-size: 12px;

  line-height: 1.5;
}

.danger {

  background: #fff3f1;

  border:
    1px solid #ffc9c2;

  color: #9d3024;

  padding: 11px;

  border-radius: 10px;

  font-size: 12px;

  line-height: 1.5;

  margin-bottom: 12px;
}


/* ================= BUTTON ================= */

.grid {

  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 10px;
}

button {

  border: 0;

  border-radius: 11px;

  padding: 13px 10px;

  cursor: pointer;

  font-size: 13px;

  font-weight: 700;

  transition: .15s;
}

button:active {
  transform: scale(.98);
}

button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.info-btn {
  background: #ee4d2d;
  color: white;
}

.order-btn {
  background: #1976d2;
  color: white;
}

.address-btn {
  background: #118a55;
  color: white;
}

.mail-btn {

  width: 100%;

  margin-top: 13px;

  background: #ff8a22;

  color: white;
}


/* ================= RESULT ================= */

.status {

  margin-bottom: 10px;

  padding: 10px;

  border-radius: 9px;

  font-size: 13px;

  font-weight: 650;

  background: #f3f4f6;
}

.status.loading {

  background: #fff7e6;

  color: #d46b08;
}

.status.success {

  background: #edf9f3;

  color: #087443;
}

.status.error {

  background: #fff1f0;

  color: #c62828;
}

pre {

  margin: 0;

  background: #10151b;

  color: #d9e2ec;

  border-radius: 12px;

  padding: 14px;

  min-height: 190px;

  max-height: 550px;

  overflow: auto;

  white-space: pre-wrap;

  word-break: break-word;

  font-size: 12px;

  line-height: 1.55;
}


/* ================= MOBILE ================= */

@media(max-width:600px) {

  .grid {
    grid-template-columns: 1fr;
  }

  .header h1 {
    font-size: 22px;
  }

}

</style>

</head>


<body>


<div class="header">

  <div class="header-inner">

    <h1>Vubel API Test</h1>

    <p>
      NK MMO Store • Test API trước khi tích hợp
    </p>

  </div>

</div>


<div class="container">


<!-- =========================================
     LOGIN DATA
========================================= -->

<div class="card">

  <h2>🔐 Phiên Shopee</h2>

  <div class="subtitle">
    Dùng chung cho các API phía dưới
  </div>


  <label>SPC_ST</label>

  <textarea
    id="spc"
    placeholder="Dán SPC_ST của tài khoản test..."
    autocomplete="off"
  ></textarea>


  <label>Proxy</label>

  <input
    id="proxy"
    type="password"
    placeholder="http://user:pass@ip:port"
    autocomplete="off"
  >


  <div class="note">

    SPC_ST và Proxy không được lưu vào
    localStorage/sessionStorage.

    Dữ liệu chỉ được gửi khi bạn bấm nút Test.

  </div>

</div>



<!-- =========================================
     READ API
========================================= -->

<div class="card">

  <h2>🧪 Test API</h2>

  <div class="subtitle">
    Nên chạy 3 chức năng đọc này trước
  </div>


  <div class="grid">


    <button
      class="info-btn"
      onclick="runAction('info')"
    >

      👤 THÔNG TIN

    </button>


    <button
      class="order-btn"
      onclick="runAction('orders')"
    >

      📦 ĐƠN HÀNG

    </button>


    <button
      class="address-btn"
      onclick="runAction('addresses')"
    >

      📍 ĐỊA CHỈ

    </button>


  </div>

</div>



<!-- =========================================
     ADD MAIL
========================================= -->

<div class="card">

  <h2>✉️ Add Mail</h2>

  <div class="subtitle">
    Sử dụng email bạn đã có
  </div>


  <div class="danger">

    ⚠️ Đây là thao tác có thể thay đổi
    thông tin tài khoản Shopee.

    Chỉ sử dụng với tài khoản của bạn
    hoặc tài khoản bạn được phép quản lý.

  </div>


  <label>Email muốn thêm</label>

  <input
    id="email"
    type="email"
    placeholder="emailcuaban@example.com"
    autocomplete="off"
  >


  <button
    class="mail-btn"
    onclick="addMail()"
  >

    ✉️ TEST ADD MAIL

  </button>

</div>



<!-- =========================================
     RESULT
========================================= -->

<div class="card">

  <h2>📋 Kết quả</h2>


  <div
    id="status"
    class="status"
  >

    Chưa gửi request

  </div>


  <pre id="result">// JSON response của Vubel sẽ hiện ở đây</pre>

</div>


</div>



<script>

// ============================================================
// FRONTEND
// ============================================================

let busy = false;


// ------------------------------------------------------------
// GET COMMON DATA
// ------------------------------------------------------------

function getData() {

  return {

    spc_st:
      document
        .getElementById("spc")
        .value
        .trim(),

    proxy:
      document
        .getElementById("proxy")
        .value
        .trim()

  };

}


// ------------------------------------------------------------
// STATUS
// ------------------------------------------------------------

function setStatus(text, type) {

  const element =
    document.getElementById("status");


  element.className =
    "status " + (type || "");


  element.textContent =
    text;

}


// ------------------------------------------------------------
// RESULT
// ------------------------------------------------------------

function showResult(data) {

  document
    .getElementById("result")
    .textContent =
      JSON.stringify(
        data,
        null,
        2
      );

}


// ------------------------------------------------------------
// VALIDATE COMMON
// ------------------------------------------------------------

function validateCommon(data) {

  if (!data.spc_st) {

    alert("Chưa nhập SPC_ST");

    return false;

  }


  if (!data.proxy) {

    alert("Chưa nhập Proxy");

    return false;

  }


  if (
    !/^https?:\\/\\//i.test(data.proxy)
  ) {

    alert(
      "Proxy phải có dạng:\\n\\n" +
      "http://ip:port\\n" +
      "hoặc\\n" +
      "http://user:pass@ip:port"
    );

    return false;

  }


  return true;

}


// ------------------------------------------------------------
// SEND REQUEST
// ------------------------------------------------------------

async function send(payload) {

  if (busy) {

    return;

  }


  busy = true;


  setStatus(
    "Đang gửi request tới Vubel...",
    "loading"
  );


  try {


    const response =
      await fetch(
        "/api/vubel-test",
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify(payload)

        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(text);

    }
    catch {

      data = {

        ok: false,

        status:
          response.status,

        raw:
          text

      };

    }


    showResult(data);


    if (
      response.ok &&
      data.ok !== false
    ) {

      setStatus(
        "✓ Vubel phản hồi thành công",
        "success"
      );

    }
    else {

      setStatus(
        "✕ API lỗi - HTTP " +
        response.status,
        "error"
      );

    }


  }
  catch (error) {


    showResult({

      ok: false,

      error:
        error.message

    });


    setStatus(
      "✕ Không thể kết nối API",
      "error"
    );


  }
  finally {

    busy = false;

  }

}


// ------------------------------------------------------------
// INFO / ORDER / ADDRESS
// ------------------------------------------------------------

function runAction(action) {

  const data =
    getData();


  if (!validateCommon(data)) {

    return;

  }


  send({

    action:
      action,

    spc_st:
      data.spc_st,

    proxy:
      data.proxy

  });

}


// ------------------------------------------------------------
// ADD MAIL
// ------------------------------------------------------------

function addMail() {

  const data =
    getData();


  if (!validateCommon(data)) {

    return;

  }


  const email =
    document
      .getElementById("email")
      .value
      .trim();


  if (!email) {

    alert(
      "Bạn chưa nhập email."
    );

    return;

  }


  if (
    !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
      .test(email)
  ) {

    alert(
      "Email không đúng định dạng."
    );

    return;

  }


  const confirmed =
    confirm(

      "XÁC NHẬN ADD MAIL\\n\\n" +

      "Email:\\n" +
      email +

      "\\n\\nThao tác này có thể thay đổi " +
      "email của tài khoản Shopee.\\n\\n" +

      "Bạn muốn tiếp tục?"

    );


  if (!confirmed) {

    return;

  }


  send({

    action:
      "addmail",

    spc_st:
      data.spc_st,

    proxy:
      data.proxy,

    email:
      email

  });

}

</script>


</body>

</html>`);

  }



  // ==========================================================
  // METHOD CHECK
  // ==========================================================

  if (req.method !== "POST") {

    return res.status(405).json({

      ok: false,

      error:
        "Chỉ hỗ trợ GET và POST"

    });

  }



  // ==========================================================
  // API KEY
  // ==========================================================

  const apiKey =
    process.env.VUBEL_API_KEY;


  if (!apiKey) {

    return res.status(500).json({

      ok: false,

      error:
        "Chưa cấu hình VUBEL_API_KEY trên Vercel"

    });

  }



  // ==========================================================
  // INPUT
  // ==========================================================

  const body =
    req.body || {};


  const action =
    String(
      body.action || ""
    ).trim();


  const spc_st =
    String(
      body.spc_st || ""
    ).trim();


  const proxy =
    String(
      body.proxy || ""
    ).trim();


  const email =
    String(
      body.email || ""
    ).trim();



  // ==========================================================
  // VALIDATION
  // ==========================================================

  if (!spc_st) {

    return res.status(400).json({

      ok: false,

      error:
        "Thiếu SPC_ST"

    });

  }


  if (!proxy) {

    return res.status(400).json({

      ok: false,

      error:
        "Thiếu proxy"

    });

  }


  if (
    !/^https?:\\/\\//i.test(proxy)
  ) {

    return res.status(400).json({

      ok: false,

      error:
        "Proxy phải bắt đầu bằng http:// hoặc https://",

      example:
        "http://user:pass@ip:port"

    });

  }



  // ==========================================================
  // ACTION
  // ==========================================================

  let endpoint;

  let requestBody;



  switch (action) {


    // ========================================================
    // SHOPEE INFO
    // ========================================================

    case "info":

      endpoint =
        "/v1/shopee/info";


      requestBody = {

        proxy:
          proxy

      };

      break;



    // ========================================================
    // GET ORDER
    // ========================================================

    case "orders":

      endpoint =
        "/v1/shopee/get_order";


      requestBody = {

        proxy:
          proxy

      };

      break;



    // ========================================================
    // ADDRESS LIST
    // ========================================================

    case "addresses":

      endpoint =
        "/v1/shopee/addresses/list";


      requestBody = {

        proxy:
          proxy

      };

      break;



    // ========================================================
    // ADD MAIL - EMAIL CÓ SẴN
    // ========================================================

    case "addmail":


      if (!email) {

        return res.status(400).json({

          ok: false,

          error:
            "Thiếu email"

        });

      }


      if (
        !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
          .test(email)
      ) {

        return res.status(400).json({

          ok: false,

          error:
            "Email không hợp lệ"

        });

      }


      endpoint =
        "/v1/shopee/addmail";


      requestBody = {

        email:
          email,

        proxy:
          proxy

      };

      break;



    default:

      return res.status(400).json({

        ok: false,

        error:
          "Action không hợp lệ",

        supported: [

          "info",
          "orders",
          "addresses",
          "addmail"

        ]

      });

  }



  // ==========================================================
  // VUBEL HEADERS
  // ==========================================================

  const headers = {

    "Accept":
      "application/json",

    "Content-Type":
      "application/json",

    "x-api-key":
      apiKey,

    "Cookie":
      "SPC_ST=" + spc_st

  };



  // ==========================================================
  // CALL VUBEL
  // ==========================================================

  try {


    const response =
      await fetch(

        VUBEL_BASE + endpoint,

        {

          method:
            "POST",

          headers:
            headers,

          body:
            JSON.stringify(
              requestBody
            )

        }

      );



    const raw =
      await response.text();



    let data;


    try {

      data =
        JSON.parse(raw);

    }
    catch {

      data = {

        raw:
          raw.slice(0, 5000)

      };

    }



    // ========================================================
    // BAD GATEWAY
    // ========================================================

    if (
      response.status === 502
    ) {

      return res.status(502).json({

        ok: false,

        action:
          action,

        endpoint:
          endpoint,

        type:
          "VUBEL_BAD_GATEWAY",

        message:
          "Vubel hoặc proxy/upstream trả lỗi 502 Bad Gateway.",

        data:
          data

      });

    }



    // ========================================================
    // VUBEL RESPONSE
    // ========================================================

    return res
      .status(response.status)
      .json({

        ok:
          response.ok,

        action:
          action,

        endpoint:
          endpoint,

        vubel_status:
          response.status,

        data:
          data

      });


  }
  catch (error) {


    console.error(
      "Vubel API error:",
      error
    );


    return res.status(500).json({

      ok: false,

      action:
        action,

      endpoint:
        endpoint,

      error:
        "Không thể kết nối Vubel",

      message:
        error.message

    });

  }

}
