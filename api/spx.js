// ============================================================
// NK MMO Store V28.7.24 - SPX newest-event fix
// Calls are allowed only from trusted NK Store server functions.
// Public/browser traffic must go through /api/track.
// ============================================================

function hasInternalAccess(req) {
    const expected = String(process.env.TRACKING_INTERNAL_SECRET || "");
    const received = String(req.headers?.["x-nk-internal-secret"] || "");
    return expected.length >= 24 && received.length === expected.length && received === expected;
}

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (!hasInternalAccess(req)) {
        return res.status(403).json({
            success: false,
            message: "Forbidden"
        });
    }

    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed"
        });
    }

    const code = String(
        req.query?.code ||
        req.body?.code ||
        req.body?.tracking_id ||
        ""
    ).trim().toUpperCase();

    if (!/^SPXVN[A-Z0-9]+$/.test(code)) {
        return res.status(400).json({
            success: false,
            message: "Mã vận đơn SPX không hợp lệ"
        });
    }

    try {
        const response = await fetch(
            "https://tramavandon.com/api/spx.php",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": "https://tramavandon.com",
                    "Referer": "https://tramavandon.com/spx/"
                },
                body: JSON.stringify({
                    tracking_id: code
                }),
                cache: "no-store"
            }
        );

        const text = await response.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error("Nguồn tracking không trả JSON");
        }

        if (
            !response.ok ||
            data.retcode !== 0 ||
            data.message !== "success"
        ) {
            return res.status(502).json({
                success: false,
                message: data.detail || data.message || "Không tra được vận đơn"
            });
        }

        const tracking =
            data.data?.sls_tracking_info || {};

        const records =
            Array.isArray(tracking.records)
                ? tracking.records
                : [];

        // Do not assume tracking.records[0] is always the newest event.
        // Some upstream responses can contain records in a non-strict order.
        // Pick the event with the greatest actual_time instead.
        const toTimeMs = (value) => {
            if (value === null || value === undefined || value === "") return 0;

            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) {
                return numeric > 1e12 ? numeric : numeric * 1000;
            }

            const parsed = Date.parse(String(value));
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const sortedRecords = records
            .map((record, index) => ({ record, index, timeMs: toTimeMs(record?.actual_time) }))
            .sort((a, b) => {
                if (b.timeMs !== a.timeMs) return b.timeMs - a.timeMs;
                return a.index - b.index;
            })
            .map(item => item.record);

        const latest = sortedRecords[0] || null;

        return res.status(200).json({
            success: true,
            tracking_code: code,

            status:
                latest?.buyer_description ||
                latest?.description ||
                "Chưa có trạng thái",

            milestone:
                latest?.milestone_name || "",

            tracking_status_code:
                latest?.tracking_code || "",

            time:
                latest?.actual_time || null,

            current_location:
                latest?.current_location?.location_name || "",

            next_location:
                latest?.next_location?.location_name || "",

            delivered:
                String(latest?.milestone_name || "")
                    .toLowerCase()
                    .includes("delivered"),

            events: sortedRecords.map(r => ({
                time: r.actual_time || null,
                status:
                    r.buyer_description ||
                    r.description ||
                    "",
                milestone:
                    r.milestone_name || "",
                code:
                    r.tracking_code || "",
                current_location:
                    r.current_location?.location_name || "",
                next_location:
                    r.next_location?.location_name || ""
            }))
        });

    } catch (error) {
        console.error("SPX ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể kết nối nguồn tra cứu SPX"
        });
    }
}
