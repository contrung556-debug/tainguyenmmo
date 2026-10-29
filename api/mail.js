const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

function extractOtp(text = "") {
  const patterns = [
    /\b(\d{6})\b/,
    /\b(\d{5})\b/,
    /\b(\d{4})\b/,
    /\b(\d{8})\b/,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }

  return null;
}

function extractLinks(text = "") {
  const matches =
    text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];

  return [...new Set(matches)].slice(0, 20);
}

function normalizeAddress(value = "") {
  return String(value).trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  const apiKey = req.headers["x-api-key"];

  if (
    !process.env.MAIL_API_KEY ||
    apiKey !== process.env.MAIL_API_KEY
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  const targetEmail = normalizeAddress(req.query.email || "");

  if (
    targetEmail &&
    !targetEmail.endsWith("@nkstore.io.vn")
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid email domain",
    });
  }

  const client = new ImapFlow({
    host: "imap.mail.me.com",
    port: 993,
    secure: true,

    auth: {
      user: process.env.ICLOUD_USER,
      pass: process.env.ICLOUD_APP_PASSWORD,
    },

    logger: false,
  });

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");

    try {
      const exists = client.mailbox.exists;

      if (!exists) {
        return res.status(200).json({
          ok: true,
          message: "Mailbox empty",
          email: targetEmail || null,
          mail: null,
        });
      }

      const start = Math.max(1, exists - 29);

      const messages = [];

      for await (const msg of client.fetch(
        `${start}:*`,
        {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        }
      )) {
        messages.push(msg);
      }

      messages.reverse();

      for (const msg of messages) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);

        const toAddresses = [];

        if (parsed.to?.value) {
          for (const item of parsed.to.value) {
            if (item.address) {
              toAddresses.push(
                normalizeAddress(item.address)
              );
            }
          }
        }

        const deliveredTo =
          normalizeAddress(
            parsed.headers.get("delivered-to") || ""
          );

        const originalTo =
          normalizeAddress(
            parsed.headers.get("x-original-to") || ""
          );

        const allRecipients = [
          ...toAddresses,
          deliveredTo,
          originalTo,
        ].filter(Boolean);

        if (
          targetEmail &&
          !allRecipients.includes(targetEmail)
        ) {
          continue;
        }

        const text =
          [
            parsed.subject || "",
            parsed.text || "",
            parsed.html
              ? String(parsed.html).replace(/<[^>]+>/g, " ")
              : "",
          ].join("\n");

        return res.status(200).json({
          ok: true,

          requested_email:
            targetEmail || null,

          uid: msg.uid,

          from:
            parsed.from?.value?.[0]?.address ||
            null,

          to: allRecipients,

          subject:
            parsed.subject || null,

          date:
            parsed.date ||
            msg.internalDate ||
            null,

          otp:
            extractOtp(text),

          links:
            extractLinks(text),

          text:
            (parsed.text || "")
              .trim()
              .slice(0, 10000),
        });
      }

      return res.status(404).json({
        ok: false,
        error: "No matching email found",
        email: targetEmail || null,
      });

    } finally {
      lock.release();
    }

  } catch (error) {
    console.error("MAIL_API_ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "IMAP error",
    });

  } finally {
    try {
      await client.logout();
    } catch (_) {}
  }
}
