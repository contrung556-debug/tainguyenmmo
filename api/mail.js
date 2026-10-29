// ============================================================
// NK MMO STORE - ICLOUD MAIL API
// VERSION: MAIL-1.0.0
//
// GET /api/mail?email=abc@nkstore.io.vn
// Header:
//   x-api-key: YOUR_MAIL_API_KEY
//
// Vercel Environment Variables:
//   ICLOUD_USER
//   ICLOUD_APP_PASSWORD
//   MAIL_API_KEY
// ============================================================

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const DOMAIN = "@nkstore.io.vn";
const MAX_MESSAGES = 50;

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
// OTP
// ============================================================

function extractOtp(text = "") {
  const source = String(text);

  // Ưu tiên số nằm gần các từ OTP / code / verification
  const strongPatterns = [
    /(?:otp|verification\s*code|verify\s*code|security\s*code|confirmation\s*code|mã\s*xác\s*minh|mã\s*otp|mã\s*bảo\s*mật)[^\d]{0,30}(\d{4,8})/i,

    /(\d{4,8})[^\d]{0,30}(?:otp|verification\s*code|security\s*code|mã\s*xác\s*minh|mã\s*otp)/i,
  ];

  for (const pattern of strongPatterns) {
    const match = source.match(pattern);

    if (match) {
      return match[1];
    }
  }

  // Fallback
  const fallbackPatterns = [
    /\b(\d{6})\b/,
    /\b(\d{5})\b/,
    /\b(\d{4})\b/,
    /\b(\d{7})\b/,
    /\b(\d{8})\b/,
  ];

  for (const pattern of fallbackPatterns) {
    const match = source.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return null;
}

// ============================================================
// LINKS
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

  const groups = [
    parsed.to?.value,
    parsed.cc?.value,
    parsed.bcc?.value,
  ];

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    for (const item of group) {
      if (item?.address) {
        recipients.push(
          normalize(item.address)
        );
      }
    }
  }

  const headerNames = [
    "delivered-to",
    "x-original-to",
    "x-envelope-to",
    "original-recipient",
    "envelope-to",
  ];

  for (const name of headerNames) {
    const value =
      parsed.headers.get(name);

    const header =
      cleanHeader(value).toLowerCase();

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
// FIND JUNK MAILBOX
// ============================================================

async function findMailboxes(client) {
  const result = ["INBOX"];

  try {
    const list = await client.list();

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
  } catch (_) {}

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
  let lock;

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

    const start = Math.max(
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
      if (!message.source) continue;

      let parsed;

      try {
        parsed =
          await simpleParser(
            message.source
          );
      } catch (_) {
        continue;
      }

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

      const htmlText =
        parsed.html
          ? String(parsed.html)
              .replace(
                /<style[\s\S]*?<\/style>/gi,
                " "
              )
              .replace(
                /<script[\s\S]*?<\/script>/gi,
                " "
              )
              .replace(
                /<[^>]+>/g,
                " "
              )
          : "";

      const bodyText = [
        parsed.subject || "",
        parsed.text || "",
        htmlText,
      ].join("\n");

      return {
        mailbox: mailboxName,

        uid: message.uid,

        from:
          parsed.from?.value?.[0]
            ?.address || null,

        from_name:
          parsed.from?.value?.[0]
            ?.name || null,

        to: recipients,

        subject:
          parsed.subject || null,

        date:
          parsed.date ||
          message.internalDate ||
          null,

        otp:
          extractOtp(bodyText),

        links:
          extractLinks(bodyText),

        text:
          String(
            parsed.text || ""
          )
            .trim()
            .slice(0, 15000),
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
// API
// ============================================================

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  // -------------------------
  // API KEY
  // -------------------------

  const receivedKey =
    String(
      req.headers["x-api-key"] || ""
    );

  const correctKey =
    String(
      process.env.MAIL_API_KEY || ""
    );

  if (
    !correctKey ||
    receivedKey !== correctKey
  ) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED",
    });
  }

  // -------------------------
  // EMAIL
  // -------------------------

  const targetEmail =
    normalize(req.query.email);

  if (!targetEmail) {
    return res.status(400).json({
      ok: false,
      error: "EMAIL_REQUIRED",
      example:
        "abc@nkstore.io.vn",
    });
  }

  if (
    !targetEmail.endsWith(DOMAIN)
  ) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_DOMAIN",
      allowed_domain:
        DOMAIN,
    });
  }

  // -------------------------
  // ENV
  // -------------------------

  const user =
    process.env.ICLOUD_USER;

  const password =
    process.env
      .ICLOUD_APP_PASSWORD;

  if (!user || !password) {
    return res.status(500).json({
      ok: false,
      error:
        "MISSING_ICLOUD_ENV",
    });
  }

  // -------------------------
  // IMAP
  // -------------------------

  const client =
    new ImapFlow({
      host:
        "imap.mail.me.com",

      port: 993,

      secure: true,

      auth: {
        user,
        pass: password,
      },

      logger: false,

      connectionTimeout:
        15000,

      greetingTimeout:
        15000,

      socketTimeout:
        30000,
    });

  try {
    await client.connect();

    const mailboxes =
      await findMailboxes(
        client
      );

    const found = [];

    for (const mailbox of mailboxes) {
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

    // Nếu cùng lúc tìm thấy Inbox và Junk
    // thì chọn thư mới nhất.
    found.sort(
      (a, b) =>
        new Date(b.date || 0) -
        new Date(a.date || 0)
    );

    return res.status(200).json({
      ok: true,

      requested_email:
        targetEmail,

      mail:
        found[0],
    });
  } catch (error) {
    console.error(
      "ICLOUD_IMAP_ERROR:",
      error
    );

    return res.status(500).json({
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
