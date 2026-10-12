/// ============================================================
// api/vubel-test.js
// CommonJS - Vercel
//
// FLOW:
// Browser
//   -> Vercel
//   -> Proxy.vn (get rotating proxy)
//   -> Vubel
//   -> Shopee
//
// ENV:
// VUBEL_API_KEY
// PROXYVN_KEY
// ============================================================

const VUBEL_BASE = "https://api.vubel.store";
const PROXYVN_API = "https://proxyxoay.shop/api/get.php";


// ============================================================
// BASIC
// ============================================================

function safeString(value) {
  return String(value == null ? "" : value).trim();
}


function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}


// ============================================================
// NORMALIZE PROXY
// ============================================================

function normalizeProxy(raw) {
  let proxy = safeString(raw);

  if (!proxy) {
    throw new Error("Proxy.vn không trả proxy HTTP");
  }

  // Ví dụ:
  // 1.2.3.4:1234::
  proxy = proxy.replace(/::$/, "");

  if (
    proxy.startsWith("http://") ||
    proxy.startsWith("https://")
  ) {
    return proxy;
  }

  return "http://" + proxy;
}


// ============================================================
// MASK PROXY
// Không trả credentials thật về browser
// ============================================================

function maskProxy(proxy) {
  try {
    const u = new URL(proxy);

    return (
      u.protocol +
      "//***:***@" +
      u.hostname +
      ":" +
      u.port
    );
  } catch (_) {
    return "[REDACTED]";
  }
}


// ============================================================
// GET PROXY FROM PROXY.VN
// ============================================================

async function getProxyVN() {
  const key = process.env.PROXYVN_KEY;

  if (!key) {
    throw new Error(
      "PROXYVN_KEY chưa được cấu hình trên Vercel"
    );
  }

  const url =
    PROXYVN_API +
    "?key=" +
    encodeURIComponent(key);

  const controller =
    new AbortController();

  const timer =
    setTimeout(function() {
      controller.abort();
    }, 15000);

  try {
    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          "Accept": "application/json"
        },

        cache: "no-store",

        signal:
          controller.signal
      });


    const text =
      await response.text();


    let data;

    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error(
        "Proxy.vn trả dữ liệu không phải JSON: " +
        text.slice(0, 300)
      );
    }


    if (!response.ok) {
      throw new Error(
        "Proxy.vn HTTP " +
        response.status
      );
    }


    if (Number(data.status) !== 100) {
      throw new Error(
        data.message ||
        data.comen ||
        data.msg ||
        "Proxy.vn không cấp được proxy"
      );
    }


    const rawProxy =
      data.proxyhttp ||
      data.proxy_http ||
      data.http ||
      data.proxy ||
      "";


    const proxy =
      normalizeProxy(rawProxy);


    return {
      proxy: proxy,

      provider:
        "Proxy.vn",

      network:
        data["Nha Mang"] ||
        data["Nhà Mạng"] ||
        data.nhamang ||
        null,

      location:
        data["Vi Tri"] ||
        data["Vị Trí"] ||
        data.tinhthanh ||
        null,

      message:
        data.message ||
        data.comen ||
        null
    };

  } catch (error) {

    if (
      error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "Proxy.vn timeout khi lấy proxy"
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// COOKIE
//
// Có thể nhập:
// 1. token SPC_ST đơn
// 2. full Cookie:
//
// SPC_U=...; SPC_EC=...; SPC_ST=...; SPC_F=...
// ============================================================

function buildCookieHeader(input) {
  const value =
    safeString(input);

  if (!value) {
    throw new Error(
      "Chưa nhập Cookie Shopee"
    );
  }

  // Có dấu "=" -> coi như full cookie/header cookie
  if (value.indexOf("=") !== -1) {
    return value;
  }

  return "SPC_ST=" + value;
}


// ============================================================
// CALL VUBEL
// ============================================================

async function callVubel(
  endpoint,
  cookieHeader,
  proxy,
  extraBody
) {

  const apiKey =
    process.env.VUBEL_API_KEY;


  if (!apiKey) {
    throw new Error(
      "VUBEL_API_KEY chưa được cấu hình trên Vercel"
    );
  }


  const requestBody =
    Object.assign(
      {
        proxy: proxy
      },
      extraBody || {}
    );


  const controller =
    new AbortController();


  const timer =
    setTimeout(function() {
      controller.abort();
    }, 35000);


  try {

    const startedAt =
      Date.now();


    const response =
      await fetch(
        VUBEL_BASE + endpoint,
        {
          method: "POST",

          headers: {
            "Accept":
              "application/json",

            "Content-Type":
              "application/json",

            "x-api-key":
              apiKey,

            "Cookie":
              cookieHeader
          },

          body:
            JSON.stringify(
              requestBody
            ),

          signal:
            controller.signal
        }
      );


    const elapsed =
      Date.now() -
      startedAt;


    const raw =
      await response.text();


    let data;

    try {
      data =
        JSON.parse(raw);
    } catch (_) {
      data = {
        raw:
          raw.slice(
            0,
            5000
          )
      };
    }


    return {
      ok:
        response.ok,

      status:
        response.status,

      elapsed_ms:
        elapsed,

      data:
        data
    };

  } catch (error) {

    if (
      error &&
      error.name === "AbortError"
    ) {
      return {
        ok: false,
        status: 504,
        elapsed_ms: 35000,
        data: {
          ok: false,
          error: "timeout",
          message:
            "Vubel/proxy timeout"
        }
      };
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// MONEY
// ============================================================

function money(value) {
  const n =
    Number(value || 0);

  try {
    return new Intl.NumberFormat(
      "vi-VN"
    ).format(n) + " đ";
  } catch (_) {
    return n + " đ";
  }
}


// ============================================================
// GET PAYMENT ROW
// ============================================================

function getPaymentRow(order, key) {

  const parcels =
    Array.isArray(order.parcels)
      ? order.parcels
      : [];


  for (
    let i = 0;
    i < parcels.length;
    i++
  ) {

    const rows =
      parcels[i] &&
      parcels[i].payment &&
      Array.isArray(
        parcels[i].payment.rows
      )
        ? parcels[i].payment.rows
        : [];


    for (
      let j = 0;
      j < rows.length;
      j++
    ) {

      if (
        rows[j] &&
        rows[j].key === key
      ) {
        return rows[j];
      }

    }
  }


  return null;
}


// ============================================================
// ALL PAYMENT ROWS
// ============================================================

function getAllPaymentRows(order) {

  const result = [];

  const parcels =
    Array.isArray(order.parcels)
      ? order.parcels
      : [];


  parcels.forEach(function(parcel) {

    const rows =
      parcel &&
      parcel.payment &&
      Array.isArray(
        parcel.payment.rows
      )
        ? parcel.payment.rows
        : [];


    rows.forEach(function(row) {

      result.push({
        key:
          row.key || null,

        label:
          row.label || null,

        amount:
          row.amount == null
            ? null
            : Number(row.amount),

        formatted:
          row.amount == null
            ? null
            : money(row.amount),

        rawValue:
          row.rawValue || null,

        valueType:
          row.valueType == null
            ? null
            : row.valueType
      });

    });

  });


  return result;
}


// ============================================================
// ITEMS
// ============================================================

function getItems(order) {

  const result = [];

  const parcels =
    Array.isArray(order.parcels)
      ? order.parcels
      : [];


  parcels.forEach(function(
    parcel,
    parcelIndex
  ) {

    const items =
      Array.isArray(parcel.items)
        ? parcel.items
        : [];


    items.forEach(function(item) {

      result.push({

        parcelNumber:
          parcel.parcelNumber ||
          parcelIndex + 1,

        itemId:
          item.itemId || null,

        modelId:
          item.modelId || null,

        shopId:
          item.shopId || null,

        name:
          item.name || "",

        modelName:
          item.modelName || "",

        quantity:
          Number(
            item.quantity || 0
          ),

        unitPrice:
          Number(
            item.unitPrice || 0
          ),

        unitPriceFormatted:
          money(
            item.unitPrice || 0
          ),

        orderPrice:
          Number(
            item.orderPrice || 0
          ),

        orderPriceFormatted:
          money(
            item.orderPrice || 0
          ),

        priceBeforeDiscount:
          item.priceBeforeDiscount == null
            ? null
            : Number(
                item.priceBeforeDiscount
              ),

        imageUrl:
          item.imageUrl || ""

      });

    });

  });


  return result;
}


// ============================================================
// SHOPS
// ============================================================

function getShops(order) {

  const shops =
    Array.isArray(order.shops)
      ? order.shops
      : [];


  return shops.map(function(shop) {

    return {

      shopId:
        shop.shopId || null,

      name:
        shop.name || "",

      username:
        shop.username || "",

      avatarUrl:
        shop.avatarUrl || ""

    };

  });
}


// ============================================================
// SHIPMENTS
// ============================================================

function getShipments(order) {

  const shipments =
    order &&
    order.shipping &&
    Array.isArray(
      order.shipping.shipments
    )
      ? order.shipping.shipments
      : [];


  return shipments.map(function(
    shipment
  ) {

    const events =
      Array.isArray(
        shipment.events
      )
        ? shipment.events
        : [];


    return {

      trackingNumber:
        shipment.trackingNumber ||
        null,

      trackingDisplay:
        shipment.trackingNumber ||
        "Chưa có mã vận đơn",

      carrier:
        shipment.carrier || "",

      events:
        events.map(function(event) {

          return {

            timestamp:
              event.timestamp || 0,

            description:
              event.description ||
              null,

            type:
              event.type == null
                ? null
                : event.type,

            driverName:
              event.driverName ||
              null,

            driverPhone:
              event.driverPhone ||
              null,

            pinCode:
              event.pinCode ||
              null

          };

        })

    };

  });
}


// ============================================================
// PROCESSING / TIMES
// ============================================================

function getProcessing(order) {

  const rows =
    order &&
    order.processing &&
    Array.isArray(
      order.processing.rows
    )
      ? order.processing.rows
      : [];


  return rows.map(function(row) {

    return {

      key:
        row.key || null,

      label:
        row.label || null,

      timestamp:
        row.timestamp || 0,

      rawValue:
        row.rawValue || null,

      valueType:
        row.valueType == null
          ? null
          : row.valueType

    };

  });
}


// ============================================================
// PARCELS
// ============================================================

function getParcels(order) {

  const parcels =
    Array.isArray(order.parcels)
      ? order.parcels
      : [];


  return parcels.map(function(parcel) {

    return {

      parcelNumber:
        parcel.parcelNumber || null,

      fulfillmentId:
        parcel.fulfillmentId || null,

      logisticsId:
        parcel.logisticsId || null,

      orderSn:
        parcel.orderSn || null,

      shopId:
        parcel.shopId || null,

      statusCode:
        parcel.statusCode == null
          ? null
          : parcel.statusCode,

      statusText:
        parcel.statusText || null

    };

  });
}


// ============================================================
// NORMALIZE ONE ORDER
// ============================================================

function normalizeOrder(order) {

  const shipments =
    getShipments(order);


  const firstShipment =
    shipments.length
      ? shipments[0]
      : {
          trackingNumber: null,
          trackingDisplay:
            "Chưa có mã vận đơn",
          carrier: "",
          events: []
        };


  const merchandise =
    getPaymentRow(
      order,
      "label_odp_merchandise_subtotal"
    );


  const shippingFee =
    getPaymentRow(
      order,
      "label_odp_shipping"
    );


  const payment =
    order.payment || {};


  const method =
    payment.method || {};


  const recipient =
    order.recipient || {};


  const driver =
    order.shipping &&
    order.shipping.driver
      ? order.shipping.driver
      : null;


  return {

    // ========================================================
    // ID
    // ========================================================

    orderId:
      order.orderId || null,

    orderSn:
      order.orderSn || null,


    // ========================================================
    // STATUS
    // ========================================================

    statusKey:
      order.statusKey || null,

    statusLabel:
      order.statusLabel ||
      "Không rõ",

    detailAvailable:
      Boolean(
        order.detailAvailable
      ),

    isCheckout:
      Boolean(
        order.isCheckout
      ),

    isCancellable:
      Boolean(
        order.isCancellable
      ),

    isConfirmable:
      Boolean(
        order.isConfirmable
      ),


    // ========================================================
    // RECIPIENT
    // ========================================================

    recipient: {

      name:
        recipient.name || "",

      phone:
        recipient.phone || "",

      address:
        recipient.address || ""

    },


    // ========================================================
    // SHIPPING
    // ========================================================

    shipping: {

      trackingNumber:
        firstShipment.trackingNumber,

      trackingDisplay:
        firstShipment.trackingDisplay,

      carrier:
        firstShipment.carrier,

      isMultiParcel:
        Boolean(
          order.shipping &&
          order.shipping.isMultiParcel
        ),

      parcelCount:
        order.shipping &&
        order.shipping.parcelCount
          ? Number(
              order.shipping.parcelCount
            )
          : shipments.length,

      driver:
        driver
          ? {
              name:
                driver.name || null,

              phone:
                driver.phone || null,

              photoUrl:
                driver.photoUrl || null
            }
          : null,

      shipments:
        shipments

    },


    // ========================================================
    // SHOP
    // ========================================================

    shops:
      getShops(order),


    // ========================================================
    // ITEMS
    // ========================================================

    items:
      getItems(order),


    // ========================================================
    // PARCELS
    // ========================================================

    parcels:
      getParcels(order),


    // ========================================================
    // PAYMENT
    // ========================================================

    payment: {

      currency:
        payment.currency ||
        "VND",

      subtotal:
        Number(
          payment.subtotal || 0
        ),

      subtotalFormatted:
        money(
          payment.subtotal || 0
        ),

      total:
        Number(
          payment.total || 0
        ),

      totalFormatted:
        money(
          payment.total || 0
        ),

      amountPaid:
        Number(
          payment.amountPaid || 0
        ),

      amountPaidFormatted:
        money(
          payment.amountPaid || 0
        ),

      vat:
        Number(
          payment.vat || 0
        ),

      vatFormatted:
        money(
          payment.vat || 0
        ),

      method: {

        code:
          method.code == null
            ? null
            : method.code,

        text:
          method.text || "",

        isTranslationKey:
          Boolean(
            method.isTranslationKey
          )

      },


      merchandiseSubtotal:
        merchandise
          ? Number(
              merchandise.amount || 0
            )
          : null,

      merchandiseSubtotalFormatted:
        merchandise
          ? money(
              merchandise.amount || 0
            )
          : null,


      shippingFee:
        shippingFee
          ? Number(
              shippingFee.amount || 0
            )
          : null,

      shippingFeeFormatted:
        shippingFee
          ? money(
              shippingFee.amount || 0
            )
          : null,


      rows:
        getAllPaymentRows(order)

    },


    // ========================================================
    // TIMES
    // ========================================================

    processing:
      getProcessing(order),


    // ========================================================
    // COINS
    // ========================================================

    coins: {

      earned:
        order.coins
          ? Number(
              order.coins.earned || 0
            )
          : 0,

      basicEarned:
        order.coins
          ? Number(
              order.coins.basicEarned || 0
            )
          : 0

    },


    // ========================================================
    // ORIGINAL MESSAGE
    // ========================================================

    message:
      order.message || ""

  };
}


// ============================================================
// NORMALIZE ORDERS RESPONSE
// ============================================================

function normalizeOrders(vubelData) {

  const inner =
    vubelData &&
    vubelData.data &&
    vubelData.data.data
      ? vubelData.data.data
      : null;


  if (!inner) {

    return {
      account: null,
      total: 0,
      returned: 0,
      hasMore: false,
      orders: []
    };

  }


  const orders =
    Array.isArray(inner.orders)
      ? inner.orders
      : [];


  return {

    schemaVersion:
      inner.schemaVersion ||
      null,

    account:
      inner.account || null,

    total:
      Number(
        inner.total || 0
      ),

    returned:
      Number(
        inner.returned ||
        orders.length
      ),

    hasMore:
      Boolean(
        inner.hasMore
      ),

    orders:
      orders.map(
        normalizeOrder
      )

  };
}


// ============================================================
// NORMALIZE ACCOUNT INFO
// ============================================================

function normalizeInfo(vubelData) {

  const account =
    vubelData &&
    vubelData.data &&
    vubelData.data.data &&
    vubelData.data.data.account
      ? vubelData.data.data.account
      : null;


  if (!account) {
    return null;
  }


  return {

    userId:
      account.userid || null,

    username:
      account.username || "",

    email:
      account.email || "",

    emailVerified:
      Boolean(
        account.email_verified
      ),

    phone:
      account.phone || "",

    phoneVerified:
      Boolean(
        account.phone_verified
      ),

    shopId:
      account.shopid || null,

    isSeller:
      Boolean(
        account.is_seller
      ),

    isMallSeller:
      account.is_mall_seller,

    nickname:
      account.nickname,

    gender:
      account.gender,

    portrait:
      account.portrait || "",

    createdAt:
      account.ctime || null,

    hasPassword:
      Boolean(
        account.has_password
      ),

    editableUsername:
      Boolean(
        account.editable_username
      ),

    notNewUser:
      Boolean(
        account.not_new_user
      ),

    birthTimestamp:
      account.birth_timestamp,

    birthTimestampVerified:
      Boolean(
        account.birth_timestamp_verified
      ),

    paymentPassword:
      account.payment_password,

    paymentLockStatus:
      account.payment_lock_info
        ? account.payment_lock_info.status
        : null,

    access:
      account.access || null

  };
}


// ============================================================
// HTML
// ============================================================

function renderPage() {

  return `<!doctype html>

<html lang="vi">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>Vubel + Proxy.vn Test</title>

<style>

*{
  box-sizing:border-box
}

body{
  margin:0;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;

  background:#f4f6f8;
  color:#202124
}

.hero{
  background:
    linear-gradient(
      135deg,
      #ee4d2d,
      #ff7b45
    );

  color:#fff;
  padding:28px 18px 38px
}

.hero-inner,
.container{
  max-width:820px;
  margin:auto
}

.hero h1{
  margin:0 0 7px;
  font-size:27px
}

.hero p{
  margin:0;
  opacity:.92
}

.container{
  margin-top:-17px;
  padding:0 14px 45px
}

.card{
  background:#fff;
  border-radius:19px;
  padding:20px;
  margin-bottom:15px;

  box-shadow:
    0 5px 22px
    rgba(0,0,0,.06)
}

h2{
  margin:0 0 6px;
  font-size:21px
}

.sub{
  color:#777;
  font-size:13px;
  line-height:1.5;
  margin-bottom:17px
}

label{
  display:block;
  font-size:14px;
  font-weight:750;
  margin:14px 0 7px
}

textarea{
  width:100%;
  min-height:120px;
  resize:vertical;

  border:
    1px solid #d9dde2;

  border-radius:13px;

  padding:14px;

  font-size:15px;

  outline:none
}

textarea:focus{
  border-color:#ee4d2d;

  box-shadow:
    0 0 0 3px
    rgba(238,77,45,.08)
}

.note{
  background:#fff8e8;
  border:1px solid #f4d487;
  color:#6e5514;

  padding:12px;
  border-radius:11px;
  margin-top:13px;

  font-size:13px;
  line-height:1.55
}

.proxy-box{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;

  padding:13px;
  margin-top:14px;

  border-radius:12px;

  background:#f6f7f9;
  border:1px solid #e1e4e8
}

.proxy-title{
  font-size:13px;
  color:#777
}

.proxy-value{
  margin-top:3px;
  font-weight:750
}

.dot{
  width:10px;
  height:10px;
  border-radius:50%;
  background:#aaa
}

.dot.live{
  background:#18a66a
}

.dot.die{
  background:#d63838
}

.grid{
  display:grid;

  grid-template-columns:
    repeat(2,1fr);

  gap:10px
}

button{
  border:0;
  border-radius:13px;

  padding:15px 10px;

  font-size:14px;
  font-weight:800;

  color:#fff;
  cursor:pointer
}

button:active{
  transform:scale(.99)
}

button:disabled{
  opacity:.55
}

.info{
  background:#e95538
}

.orders{
  background:#3978d0
}

.all{
  width:100%;
  margin-top:10px;
  background:#7a51cc
}

.status{
  padding:12px 13px;

  border-radius:11px;

  background:#f3f4f6;

  font-size:13px;
  font-weight:750;

  margin-bottom:12px
}

.status.loading{
  background:#fff7e6;
  color:#a75c00
}

.status.success{
  background:#edf9f3;
  color:#087443
}

.status.error{
  background:#fff1f0;
  color:#c62828
}

pre{
  margin:0;

  background:#10151b;
  color:#d9e2ec;

  border-radius:14px;

  padding:16px;

  min-height:220px;
  max-height:700px;

  overflow:auto;

  white-space:pre-wrap;
  word-break:break-word;

  font-size:12px;
  line-height:1.55
}

.order{
  border:
    1px solid #e3e6ea;

  border-radius:15px;

  padding:15px;

  margin-top:12px
}

.order-title{
  font-weight:850;
  font-size:17px
}

.badge{
  display:inline-block;

  padding:5px 8px;

  border-radius:8px;

  background:#f1f3f5;

  font-size:12px;

  margin-top:7px
}

.row{
  display:grid;

  grid-template-columns:
    145px 1fr;

  gap:7px;

  padding:7px 0;

  border-bottom:
    1px dashed #eceef0;

  font-size:13px
}

.row:last-child{
  border-bottom:0
}

.key{
  color:#777
}

.value{
  font-weight:650;
  word-break:break-word
}

.items{
  margin-top:12px
}

.item{
  display:flex;
  gap:10px;

  padding:10px 0;

  border-top:
    1px solid #eee
}

.item img{
  width:55px;
  height:55px;

  border-radius:9px;

  object-fit:cover;

  background:#eee
}

.item-name{
  font-size:13px;
  font-weight:700
}

.item-sub{
  color:#777;
  font-size:12px;
  margin-top:4px
}

.hidden{
  display:none
}

@media(max-width:600px){

  .grid{
    grid-template-columns:1fr
  }

  .hero h1{
    font-size:24px
  }

  .card{
    padding:18px
  }

  .row{
    grid-template-columns:
      115px 1fr
  }

}

</style>

</head>

<body>

<header class="hero">

<div class="hero-inner">

<h1>Vubel + Proxy.vn</h1>

<p>
T&#7921; &#273;&#7897;ng l&#7845;y proxy
&rarr;
ki&#7875;m tra request
&rarr;
Vubel
</p>

</div>

</header>


<main class="container">


<section class="card">

<h2>Phi&ecirc;n Shopee</h2>

<div class="sub">
D&aacute;n SPC_ST ho&#7863;c full Cookie c&#7911;a
t&agrave;i kho&#7843;n b&#7841;n &#273;&#432;&#7907;c ph&eacute;p qu&#7843;n l&yacute;.
</div>


<label for="spc">
Cookie Shopee
</label>


<textarea
  id="spc"
  placeholder="SPC_ST ho&#7863;c full Cookie..."
  autocomplete="off"
></textarea>


<div class="note">

Proxy kh&ocirc;ng c&#7847;n nh&#7853;p th&#7911; c&ocirc;ng.
Server s&#7869; d&ugrave;ng PROXYVN_KEY tr&ecirc;n Vercel
&#273;&#7875; l&#7845;y proxy.

Cookie v&agrave; key kh&ocirc;ng &#273;&#432;&#7907;c l&#432;u
v&agrave;o localStorage/sessionStorage.

</div>


<div class="proxy-box">

<div>

<div class="proxy-title">
Proxy
</div>

<div
  id="proxyStatus"
  class="proxy-value"
>
Ch&#432;a ki&#7875;m tra
</div>

</div>

<div
  id="proxyDot"
  class="dot"
></div>

</div>

</section>


<section class="card">

<h2>Ch&#7913;c n&#259;ng</h2>

<div class="sub">
D&#7919; li&#7879;u &#273;&#432;&#7907;c l&#7845;y qua Vubel.
</div>


<div class="grid">

<button
  class="info"
  onclick="runAction('info')"
>
TH&Ocirc;NG TIN
</button>


<button
  class="orders"
  onclick="runAction('orders')"
>
&#272;&#416;N H&Agrave;NG
</button>

</div>


<button
  class="all"
  onclick="runAction('all')"
>
L&#7844;Y T&#7844;T C&#7842;
</button>

</section>


<section
  id="ordersCard"
  class="card hidden"
>

<h2>Danh s&aacute;ch &#273;&#417;n</h2>

<div id="ordersList"></div>

</section>


<section class="card">

<h2>K&#7871;t qu&#7843; JSON</h2>

<div
  id="status"
  class="status"
>
Ch&#432;a g&#7917;i request
</div>

<pre id="result">
// JSON response se hien o day
</pre>

</section>


</main>


<script>

var busy = false;


// ============================================================
// STATUS
// ============================================================

function setStatus(
  text,
  type
) {

  var el =
    document.getElementById(
      "status"
    );

  el.className =
    "status " +
    (type || "");

  el.textContent =
    text;
}


// ============================================================
// PROXY STATUS
// ============================================================

function setProxyStatus(
  text,
  type
) {

  document
    .getElementById(
      "proxyStatus"
    )
    .textContent =
      text;


  var dot =
    document.getElementById(
      "proxyDot"
    );


  dot.className =
    "dot " +
    (type || "");
}


// ============================================================
// JSON
// ============================================================

function show(data) {

  document
    .getElementById(
      "result"
    )
    .textContent =
      JSON.stringify(
        data,
        null,
        2
      );
}


// ============================================================
// ESCAPE HTML
// ============================================================

function esc(value) {

  return String(
    value == null
      ? ""
      : value
  )
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}


// ============================================================
// ORDER UI
// ============================================================

function renderOrders(orders) {

  var card =
    document.getElementById(
      "ordersCard"
    );


  var list =
    document.getElementById(
      "ordersList"
    );


  if (
    !Array.isArray(orders)
  ) {

    card.classList.add(
      "hidden"
    );

    list.innerHTML = "";

    return;
  }


  card.classList.remove(
    "hidden"
  );


  if (!orders.length) {

    list.innerHTML =
      "<div class='sub'>Khong co don hang.</div>";

    return;
  }


  var html = "";


  orders.forEach(function(order) {

    var shipping =
      order.shipping || {};


    var payment =
      order.payment || {};


    var recipient =
      order.recipient || {};


    html +=
      "<div class='order'>";


    html +=
      "<div class='order-title'>" +
      "Don #" +
      esc(
        order.orderId ||
        ""
      ) +
      "</div>";


    html +=
      "<div class='badge'>" +
      esc(
        order.statusLabel ||
        ""
      ) +
      "</div>";


    html +=
      row(
        "Ma don",
        order.orderSn
      );


    html +=
      row(
        "Ma van don",
        shipping.trackingDisplay
      );


    html +=
      row(
        "DVVC",
        shipping.carrier
      );


    html +=
      row(
        "Nguoi nhan",
        recipient.name
      );


    html +=
      row(
        "SDT",
        recipient.phone
      );


    html +=
      row(
        "Dia chi",
        recipient.address
      );


    html +=
      row(
        "Thanh tien",
        payment.totalFormatted
      );


    html +=
      row(
        "Da thanh toan",
        payment.amountPaidFormatted
      );


    html +=
      row(
        "Phuong thuc",
        payment.method
          ? payment.method.text
          : ""
      );


    html +=
      "<div class='items'>";


    var items =
      Array.isArray(order.items)
        ? order.items
        : [];


    items.forEach(function(item) {

      html +=
        "<div class='item'>";


      if (item.imageUrl) {

        html +=
          "<img src='" +
          esc(item.imageUrl) +
          "' alt=''>";

      }


      html +=
        "<div>" +

        "<div class='item-name'>" +
        esc(item.name) +
        "</div>" +

        "<div class='item-sub'>" +
        esc(item.modelName) +
        " &times;" +
        esc(item.quantity) +
        " &bull; " +
        esc(
          item.unitPriceFormatted
        ) +
        "</div>" +

        "</div>";


      html +=
        "</div>";

    });


    html +=
      "</div>";


    html +=
      "</div>";

  });


  list.innerHTML =
    html;
}


function row(
  key,
  value
) {

  return (
    "<div class='row'>" +

      "<div class='key'>" +
      esc(key) +
      "</div>" +

      "<div class='value'>" +
      esc(
        value == null ||
        value === ""
          ? "-"
          : value
      ) +
      "</div>" +

    "</div>"
  );
}


// ============================================================
// SEND
// ============================================================

async function runAction(action) {

  if (busy) {
    return;
  }


  var spc =
    document
      .getElementById(
        "spc"
      )
      .value
      .trim();


  if (!spc) {

    alert(
      "Chua nhap Cookie Shopee"
    );

    return;
  }


  busy = true;


  setStatus(
    "Dang lay proxy va goi Vubel...",
    "loading"
  );


  setProxyStatus(
    "Dang kiem tra...",
    ""
  );


  try {

    var response =
      await fetch(
        "/api/vubel-test",
        {
          method:"POST",

          headers:{
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              action:action,
              spc_st:spc
            })
        }
      );


    var text =
      await response.text();


    var data;


    try {

      data =
        JSON.parse(text);

    } catch(e) {

      data = {
        ok:false,
        status:
          response.status,
        raw:text
      };

    }


    show(data);


    if (
      data &&
      data.proxy &&
      data.proxy.status === "LIVE"
    ) {

      setProxyStatus(
        "LIVE - Proxy.vn",
        "live"
      );

    } else if (
      data &&
      data.stage === "GET_PROXY"
    ) {

      setProxyStatus(
        "Khong lay duoc proxy",
        "die"
      );

    } else if (
      data &&
      data.proxy
    ) {

      setProxyStatus(
        data.proxy.status ||
        "Loi proxy/upstream",
        "die"
      );

    }


    if (
      data &&
      data.orders &&
      Array.isArray(
        data.orders.orders
      )
    ) {

      renderOrders(
        data.orders.orders
      );

    } else if (
      action === "orders"
    ) {

      renderOrders([]);

    }


    if (
      response.ok &&
      data.ok !== false
    ) {

      setStatus(
        "Thanh cong",
        "success"
      );

    } else {

      setStatus(
        "Loi - HTTP " +
        response.status,
        "error"
      );

    }

  } catch(e) {

    show({
      ok:false,
      error:e.message
    });


    setStatus(
      "Khong the ket noi API",
      "error"
    );


    setProxyStatus(
      "Loi ket noi",
      "die"
    );

  } finally {

    busy = false;

  }
}

</script>

</body>

</html>`;
}


// ============================================================
// MAIN HANDLER
// ============================================================

module.exports =
async function handler(
  req,
  res
) {

  // ==========================================================
  // GET PAGE
  // ==========================================================

  if (
    req.method === "GET"
  ) {

    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0"
    );

    return res
      .status(200)
      .send(
        renderPage()
      );
  }


  // ==========================================================
  // POST ONLY
  // ==========================================================

  if (
    req.method !== "POST"
  ) {

    return res
      .status(405)
      .json({
        ok:false,
        error:
          "Method not allowed"
      });
  }


  // ==========================================================
  // ENV
  // ==========================================================

  if (
    !process.env.VUBEL_API_KEY
  ) {

    return res
      .status(500)
      .json({
        ok:false,
        error:
          "VUBEL_API_KEY chưa được cấu hình"
      });
  }


  if (
    !process.env.PROXYVN_KEY
  ) {

    return res
      .status(500)
      .json({
        ok:false,
        error:
          "PROXYVN_KEY chưa được cấu hình"
      });
  }


  // ==========================================================
  // INPUT
  // ==========================================================

  const body =
    req.body || {};


  const action =
    safeString(
      body.action
    );


  const spc =
    safeString(
      body.spc_st
    );


  if (!spc) {

    return res
      .status(400)
      .json({
        ok:false,
        error:
          "Missing Shopee Cookie"
      });
  }


  if (
    ![
      "info",
      "orders",
      "all"
    ].includes(action)
  ) {

    return res
      .status(400)
      .json({
        ok:false,
        error:
          "Invalid action"
      });
  }


  // ==========================================================
  // COOKIE
  // ==========================================================

  let cookieHeader;

  try {

    cookieHeader =
      buildCookieHeader(spc);

  } catch(error) {

    return res
      .status(400)
      .json({
        ok:false,
        error:
          error.message
      });
  }


  // ==========================================================
  // GET PROXY
  // ==========================================================

  let proxyInfo;


  try {

    proxyInfo =
      await getProxyVN();

  } catch(error) {

    console.error(
      "Proxy.vn error:",
      error
    );


    return res
      .status(502)
      .json({

        ok:false,

        stage:
          "GET_PROXY",

        proxy:{
          provider:
            "Proxy.vn",

          status:
            "ERROR"
        },

        error:
          "Không lấy được proxy",

        message:
          error &&
          error.message
            ? error.message
            : String(error)

      });
  }


  const proxy =
    proxyInfo.proxy;


  // Server log only masked version
  console.log(
    "Using Proxy.vn:",
    maskProxy(proxy)
  );


  // ==========================================================
  // INFO
  // ==========================================================

  if (
    action === "info"
  ) {

    try {

      const result =
        await callVubel(
          "/v1/shopee/info",
          cookieHeader,
          proxy
        );


      if (
        result.status === 502 ||
        result.status === 504
      ) {

        return res
          .status(502)
          .json({

            ok:false,

            stage:
              "PROXY_CHECK",

            proxy:{
              provider:
                "Proxy.vn",

              status:
                "DIE_OR_UPSTREAM_ERROR",

              network:
                proxyInfo.network,

              location:
                proxyInfo.location
            },

            vubel_status:
              result.status,

            data:
              result.data

          });
      }


      return res
        .status(result.status)
        .json({

          ok:
            result.ok,

          action:
            "info",

          endpoint:
            "/v1/shopee/info",

          proxy:{
            provider:
              "Proxy.vn",

            status:
              result.ok
                ? "LIVE"
                : "REQUEST_REACHED_VUBEL",

            network:
              proxyInfo.network,

            location:
              proxyInfo.location
          },

          vubel_status:
            result.status,

          elapsed_ms:
            result.elapsed_ms,

          account:
            normalizeInfo(
              result.data
            ),

          raw:
            result.data

        });

    } catch(error) {

      console.error(
        "Info error:",
        error
      );


      return res
        .status(500)
        .json({

          ok:false,

          action:
            "info",

          error:
            "Cannot call Vubel",

          message:
            error.message

        });
    }
  }


  // ==========================================================
  // ORDERS
  // ==========================================================

  if (
    action === "orders"
  ) {

    try {

      const result =
        await callVubel(
          "/v1/shopee/get_order",
          cookieHeader,
          proxy
        );


      if (
        result.status === 502 ||
        result.status === 504
      ) {

        return res
          .status(502)
          .json({

            ok:false,

            stage:
              "PROXY_CHECK",

            proxy:{
              provider:
                "Proxy.vn",

              status:
                "DIE_OR_UPSTREAM_ERROR",

              network:
                proxyInfo.network,

              location:
                proxyInfo.location
            },

            vubel_status:
              result.status,

            data:
              result.data

          });
      }


      return res
        .status(result.status)
        .json({

          ok:
            result.ok,

          action:
            "orders",

          endpoint:
            "/v1/shopee/get_order",

          proxy:{
            provider:
              "Proxy.vn",

            status:
              result.ok
                ? "LIVE"
                : "REQUEST_REACHED_VUBEL",

            network:
              proxyInfo.network,

            location:
              proxyInfo.location
          },

          vubel_status:
            result.status,

          elapsed_ms:
            result.elapsed_ms,

          orders:
            normalizeOrders(
              result.data
            ),

          raw:
            result.data

        });

    } catch(error) {

      console.error(
        "Orders error:",
        error
      );


      return res
        .status(500)
        .json({

          ok:false,

          action:
            "orders",

          error:
            "Cannot call Vubel",

          message:
            error.message

        });
    }
  }


  // ==========================================================
  // ALL
  //
  // Dùng CÙNG MỘT proxy cho INFO + ORDERS.
  // Không xin proxy mới giữa hai request.
  // ==========================================================

  if (
    action === "all"
  ) {

    try {

      const infoResult =
        await callVubel(
          "/v1/shopee/info",
          cookieHeader,
          proxy
        );


      // Nếu upstream/proxy lỗi ngay request đầu
      // thì không tiếp tục.
      if (
        infoResult.status === 502 ||
        infoResult.status === 504
      ) {

        return res
          .status(502)
          .json({

            ok:false,

            stage:
              "PROXY_CHECK",

            proxy:{
              provider:
                "Proxy.vn",

              status:
                "DIE_OR_UPSTREAM_ERROR",

              network:
                proxyInfo.network,

              location:
                proxyInfo.location
            },

            info:{
              status:
                infoResult.status,

              data:
                infoResult.data
            }

          });
      }


      // Delay nhỏ để tránh dồn request
      await sleep(250);


      const ordersResult =
        await callVubel(
          "/v1/shopee/get_order",
          cookieHeader,
          proxy
        );


      if (
        ordersResult.status === 502 ||
        ordersResult.status === 504
      ) {

        return res
          .status(502)
          .json({

            ok:false,

            stage:
              "PROXY_CHECK",

            proxy:{
              provider:
                "Proxy.vn",

              status:
                "DIE_OR_UPSTREAM_ERROR",

              network:
                proxyInfo.network,

              location:
                proxyInfo.location
            },

            info:{
              ok:
                infoResult.ok,

              status:
                infoResult.status,

              account:
                normalizeInfo(
                  infoResult.data
                )
            },

            orders:{
              status:
                ordersResult.status,

              data:
                ordersResult.data
            }

          });
      }


      const everythingOK =
        infoResult.ok &&
        ordersResult.ok;


      return res
        .status(
          everythingOK
            ? 200
            : (
                !infoResult.ok
                  ? infoResult.status
                  : ordersResult.status
              )
        )
        .json({

          ok:
            everythingOK,

          action:
            "all",

          proxy:{
            provider:
              "Proxy.vn",

            status:
              everythingOK
                ? "LIVE"
                : "REQUEST_REACHED_VUBEL",

            network:
              proxyInfo.network,

            location:
              proxyInfo.location
          },

          account:
            normalizeInfo(
              infoResult.data
            ),

          orders:
            normalizeOrders(
              ordersResult.data
            ),

          request_status:{

            info:{
              http:
                infoResult.status,

              elapsed_ms:
                infoResult.elapsed_ms
            },

            orders:{
              http:
                ordersResult.status,

              elapsed_ms:
                ordersResult.elapsed_ms
            }

          },

          raw:{

            info:
              infoResult.data,

            orders:
              ordersResult.data

          }

        });

    } catch(error) {

      console.error(
        "ALL error:",
        error
      );


      return res
        .status(500)
        .json({

          ok:false,

          action:
            "all",

          error:
            "Cannot complete request",

          message:
            error &&
            error.message
              ? error.message
              : String(error)

        });
    }
  }

};
