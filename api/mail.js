// ============================================================
// NK MMO STORE - ICLOUD OTP MAIL API
// VERSION: MAIL-1.1.0
//
// Supports:
// - Facebook OTP
// - Shopee OTP
// - TikTok OTP
// - INBOX + Junk/Spam
// - Catch-all @nkstore.io.vn
// - OTP + verification links
//
// GET:
// /api/mail?email=abc@nkstore.io.vn
//
// HEADER:
// x-api-key: YOUR_MAIL_API_KEY
//
// Vercel Environment Variables:
// ICLOUD_USER
// ICLOUD_APP_PASSWORD
// MAIL_API_KEY
// ============================================================

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const DOMAIN = "@nkstore.io.vn";

// Số thư mới nhất cần kiểm tra trong mỗi folder
const MAX_MESSAGES = 80;


// ============================================================
// BASIC
// ============================================================

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanHeader(value) {
  if (!value) return "";

  if (Array.isArray(value)) {
    return value.join(" ");
  }

  return String(value);
}


// ============================================================
// PROVIDER DETECTION
// ============================================================

function detectProvider(parsed) {
  const from =
    parsed.from?.value?.[0]?.address?.toLowerCase() || "";

  const fromName =
    parsed.from?.value?.[0]?.name?.toLowerCase() || "";

  const subject =
    String(parsed.subject || "").toLowerCase();

  const all = `${from} ${fromName} ${subject}`;


  // --------------------------
  // FACEBOOK / META
  // --------------------------

  if (
    all.includes("facebookmail.com") ||
    all.includes("facebook.com") ||
    all.includes("facebook") ||
    all.includes("meta")
  ) {
    return "facebook";
  }


  // --------------------------
  // SHOPEE
  // --------------------------

  if (
    all.includes("shopee") ||
    all.includes("shopee.vn") ||
    all.includes("shopee.com")
  ) {
    return "shopee";
  }


  // --------------------------
  // TIKTOK
  // --------------------------

  if (
    all.includes("tiktok") ||
    all.includes("tiktok.com") ||
    all.includes("bytedance")
  ) {
    return "tiktok";
  }


  return "unknown";
}


// ============================================================
// OTP EXTRACTION
// ============================================================

function extractOtp(text = "", provider = "unknown") {
  const source = String(text);


  // ==========================================================
  // PATTERN RIÊNG THEO DỊCH VỤ
  // ==========================================================

  const providerPatterns = {
    facebook: [
      /(?:facebook|meta)[\s\S]{0,500}?\b(\d{6})\b/i,

      /(?:confirmation\s*code|security\s*code|verification\s*code|mã\s*xác\s*nhận|mã\s*xác\s*minh)[^\d]{0,100}(\d{5,8})/i,

      /\b(\d{5,8})\b[\s\S]{0,150}?(?:facebook|meta)/i,
    ],

    shopee: [
      /shopee[\s\S]{0,500}?\b(\d{4,8})\b/i,

      /(?:otp|verification\s*code|verification\s*number|mã\s*otp|mã\s*xác\s*minh|mã\s*xác\s*nhận|mã\s*bảo\s*mật)[^\d]{0,100}(\d{4,8})/i,

      /\b(\d{4,8})\b[\s\S]{0,150}?shopee/i,
    ],

    tiktok: [
      /tiktok[\s\S]{0,500}?\b(\d{4,8})\b/i,

      /(?:verification\s*code|verification\s*number|security\s*code|mã\s*xác\s*minh|mã\s*xác\s*nhận)[^\d]{0,100}(\d{4,8})/i,

      /\b(\d{4,8})\b[\s\S]{0,150}?tiktok/i,
    ],
  };


  // Ưu tiên pattern riêng
  const specific =
    providerPatterns[provider] || [];

  for (const pattern of specific) {
    const match = source.match(pattern);

    if (match && match[1]) {
      return match[1];
    }
  }


  // ==========================================================
  // PATTERN CHUNG
  // ==========================================================

  const commonPatterns = [
    /(?:verification\s*code|confirmation\s*code|security\s*code|verify\s*code|otp|one[-\s]*time\s*password|mã\s*xác\s*minh|mã\s*xác\s*nhận|mã\s*bảo\s*mật|mã\s*otp)[^\d]{0,100}(\d{4,8})/i,

    /(\d{4,8})[^\d]{0,100}(?:verification\s*code|confirmation\s*code|security\s*code|otp|mã\s*xác\s*minh|mã\s*xác\s*nhận|mã\s*bảo\s*mật)/i,
  ];

  for (const pattern of commonPatterns) {
    const match = source.match(pattern);

    if (match && match[1]) {
      return match[1];
    }
  }


  // ==========================================================
  // FALLBACK
  // ==========================================================

  const fallbackPatterns = [
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
    /\b(\d{5})\b/,
    /\b(\d{7})\b/,
    /\b(\d{8})\b/,
  ];

  for (const pattern of fallbackPatterns) {
    const match = source.match(pattern);

    if (match && match[1]) {
      return match[1];
    }
  }


  return null;
}


// ============================================================
// LINK EXTRACTION
// ============================================================

function extractLinks(text = "") {
  const links =
    String(text).match(
      /https?:\/\/[^\s<>"')\]}]+/gi
    ) || [];

  return [...new Set(links)]
    .map((url) =>
      url.replace(/[.,;]+$/, "")
    )
    .slice(0, 20);
}


// ============================================================
// RECIPIENTS
// ============================================================

function getRecipients(parsed) {
  const recipients = [];


  // --------------------------
  // To / CC / BCC
  // --------------------------

  const groups = [
    parsed.to?.value,
    parsed.cc?.value,
    parsed.bcc?.value,
  ];

  for (const group of groups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const item of group) {
      if (item?.address) {
        recipients.push(
          normalize(item.address)
        );
      }
    }
  }


  // --------------------------
  // Headers
  // --------------------------

  const headerNames = [
    "delivered-to",
    "x-original-to",
    "x-envelope-to",
    "original-recipient",
    "envelope-to",
    "apparently-to",
  ];

  for (const name of headerNames) {
    const value =
      parsed.headers.get(name);

    const header =
      cleanHeader(value)
        .toLowerCase();

    const found =
      header.match(
        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
      ) || [];

    for (const email of found) {
      recipients.push(
        normalize(email)
      );
    }
  }


  return [...new Set(recipients)];
}


// ============================================================
// HTML -> TEXT
// ============================================================

function htmlToText(html) {
  if (!html) {
    return "";
  }

  return String(html)

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )

    .replace(
      /<br\s*\/?>/gi,
      "\n"
    )

    .replace(
      /<\/p>/gi,
      "\n"
    )

    .replace(
      /<[^>]+>/g,
      " "
    )

    .replace(
      /&nbsp;/gi,
      " "
    )

    .replace(
      /&amp;/gi,
      "&"
    )

    .replace(
      /&lt;/gi,
      "<"
    )

    .replace(
      /&gt;/gi,
      ">"
    );
}


// ============================================================
// FIND INBOX + JUNK/SPAM MAILBOXES
// ============================================================

async function findMailboxes(client) {
  const result = ["INBOX"];

  try {
    const list =
      await client.list();

    for (const mailbox of list) {
      const specialUse =
        String(
          mailbox.specialUse || ""
        ).toLowerCase();

      const path =
        String(
          mailbox.path || ""
        );

      const lowerPath =
        path.toLowerCase();


      const isJunk =
        specialUse === "\\junk" ||
        specialUse.includes("junk") ||
        lowerPath === "junk" ||
        lowerPath.includes("junk") ||
        lowerPath.includes("spam");


      if (
        isJunk &&
        !result.includes(path)
      ) {
        result.push(path);
      }
    }
  } catch (error) {
    console.error(
      "LIST_MAILBOX_ERROR:",
      error.message
    );
  }


  return result;
}


// ============================================================
// READ ONE MAILBOX
// ============================================================

async function searchMailbox(
  client,
  mailboxName,
  targetEmail
) {
  let lock = null;

  try {
    lock =
      await client.getMailboxLock(
        mailboxName
      );


    const total =
      Number(
        client.mailbox?.exists || 0
      );


    if (!total) {
      return null;
    }


    const start =
      Math.max(
        1,
        total - MAX_MESSAGES + 1
      );


    const messages = [];


    for await (
      const message of client.fetch(
        `${start}:*`,
        {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        }
      )
    ) {
      messages.push(message);
    }


    // Mới nhất trước
    messages.reverse();


    for (const message of messages) {
      if (!message.source) {
        continue;
      }


      let parsed;

      try {
        parsed =
          await simpleParser(
            message.source
          );
      } catch (error) {
        continue;
      }


      // ======================================================
      // KIỂM TRA EMAIL ĐÍCH
      // ======================================================

      const recipients =
        getRecipients(parsed);


      if (
        targetEmail &&
        !recipients.includes(
          targetEmail
        )
      ) {
        continue;
      }


      // ======================================================
      // NHẬN DIỆN FACEBOOK / SHOPEE / TIKTOK
      // ======================================================

      const provider =
        detectProvider(parsed);


      // Bỏ qua mail dịch vụ khác
      if (
        ![
          "facebook",
          "shopee",
          "tiktok",
        ].includes(provider)
      ) {
        continue;
      }


      // ======================================================
      // BUILD BODY
      // ======================================================

      const plainText =
        String(
          parsed.text || ""
        );


      const htmlText =
        htmlToText(
          parsed.html
        );


      const bodyText = [
        parsed.subject || "",
        plainText,
        htmlText,
      ].join("\n");


      // ======================================================
      // OTP
      // ======================================================

      const otp =
        extractOtp(
          bodyText,
          provider
        );


      // ======================================================
      // LINKS
      // ======================================================

      const links =
        extractLinks(
          [
            plainText,
            parsed.html || "",
          ].join("\n")
        );


      // ======================================================
      // RESULT
      // ======================================================

      return {
        mailbox:
          mailboxName,

        uid:
          message.uid,

        provider,

        from:
          parsed.from
            ?.value?.[0]
            ?.address || null,

        from_name:
          parsed.from
            ?.value?.[0]
            ?.name || null,

        to:
          recipients,

        subject:
          parsed.subject || null,

        date:
          parsed.date ||
          message.internalDate ||
          null,

        otp,

        links,

        text:
          plainText
            .trim()
            .slice(
              0,
              15000
            ),
      };
    }


    return null;

  } finally {
    if (lock) {
      lock.release();
    }
  }
}


// ============================================================
// API HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );


  // ==========================================================
  // METHOD
  // ==========================================================

  if (req.method !== "GET") {
    return res
      .status(405)
      .json({
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      });
  }


  // ==========================================================
  // API KEY
  // ==========================================================

  const receivedKey =
    String(
      req.headers[
        "x-api-key"
      ] || ""
    );


  const correctKey =
    String(
      process.env
        .MAIL_API_KEY || ""
    );


  if (
    !correctKey ||
    receivedKey !== correctKey
  ) {
    return res
      .status(401)
      .json({
        ok: false,
        error:
          "UNAUTHORIZED",
      });
  }


  // ==========================================================
  // TARGET EMAIL
  // ==========================================================

  const targetEmail =
    normalize(
      req.query.email
    );


  if (!targetEmail) {
    return res
      .status(400)
      .json({
        ok: false,

        error:
          "EMAIL_REQUIRED",

        example:
          "abc@nkstore.io.vn",
      });
  }


  if (
    !targetEmail.endsWith(
      DOMAIN
    )
  ) {
    return res
      .status(400)
      .json({
        ok: false,

        error:
          "INVALID_DOMAIN",

        allowed_domain:
          DOMAIN,
      });
  }


  // ==========================================================
  // ENVIRONMENT VARIABLES
  // ==========================================================

  const user =
    process.env.ICLOUD_USER;


  const password =
    process.env
      .ICLOUD_APP_PASSWORD;


  if (
    !user ||
    !password
  ) {
    return res
      .status(500)
      .json({
        ok: false,

        error:
          "MISSING_ICLOUD_ENV",
      });
  }


  // ==========================================================
  // CONNECT ICLOUD IMAP
  // ==========================================================

  const client =
    new ImapFlow({
      host:
        "imap.mail.me.com",

      port:
        993,

      secure:
        true,

      auth: {
        user,
        pass:
          password,
      },

      logger:
        false,

      connectionTimeout:
        15000,

      greetingTimeout:
        15000,

      socketTimeout:
        30000,
    });


  try {
    await client.connect();


    // ========================================================
    // FIND MAILBOXES
    // ========================================================

    const mailboxes =
      await findMailboxes(
        client
      );


    const found = [];


    // ========================================================
    // SEARCH INBOX + JUNK
    // ========================================================

    for (
      const mailbox
      of mailboxes
    ) {
      try {
        const mail =
          await searchMailbox(
            client,
            mailbox,
            targetEmail
          );


        if (mail) {
          found.push(mail);
        }

      } catch (error) {
        console.error(
          "MAILBOX_ERROR:",
          mailbox,
          error.message
        );
      }
    }


    // ========================================================
    // NOT FOUND
    // ========================================================

    if (!found.length) {
      return res
        .status(404)
        .json({
          ok: false,

          error:
            "MAIL_NOT_FOUND",

          email:
            targetEmail,

          searched:
            mailboxes,
        });
    }


    // ========================================================
    // PICK NEWEST
    // ========================================================

    found.sort(
      (a, b) =>
        new Date(
          b.date || 0
        ) -
        new Date(
          a.date || 0
        )
    );


    const newest =
      found[0];


    // ========================================================
    // SUCCESS
    // ========================================================

    return res
      .status(200)
      .json({
        ok: true,

        requested_email:
          targetEmail,

        provider:
          newest.provider,

        otp:
          newest.otp,

        links:
          newest.links,

        mail:
          newest,
      });

  } catch (error) {

    console.error(
      "ICLOUD_IMAP_ERROR:",
      error
    );


    return res
      .status(500)
      .json({
        ok: false,

        error:
          "ICLOUD_IMAP_ERROR",

        message:
          error.message ||
          "Unknown IMAP error",
      });

  } finally {

    try {
      await client.logout();
    } catch (_) {}

  }
}
