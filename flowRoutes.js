import express from "express";

const router = express.Router();

/**
 * ENV defaults (khớp đúng thứ bạn đang dùng)
 */
const FLOW_SESSION_VALIDATE_URL =
  process.env.FLOW_SESSION_VALIDATE_URL || "https://labs.google/fx/api/auth/session";

const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/video/generate";

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/video/status";

/**
 * Helpers
 */
function safeJsonParse(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function normalizeProxyBase(base) {
  if (!base) return "";
  let b = String(base).trim();
  // remove trailing slashes
  b = b.replace(/\/+$/, "");
  return b;
}

/**
 * Nhận session input dưới nhiều dạng:
 * - string "ya29...."
 * - JSON string {"access_token":"ya29...","expires":"..."}
 * - object {access_token:"ya29..."}
 * - object {session:{access_token:"ya29..."}} (một số app bọc thêm)
 */
function extractAccessToken(sessionInput) {
  if (!sessionInput) return "";

  // If string => may be token or JSON string
  if (typeof sessionInput === "string") {
    const s = sessionInput.trim();
    const parsed = safeJsonParse(s);
    if (parsed && typeof parsed === "object") {
      return (
        parsed.access_token ||
        parsed.token ||
        parsed.accessToken ||
        parsed?.session?.access_token ||
        ""
      );
    }
    return s; // treat as raw token
  }

  // If object
  if (typeof sessionInput === "object") {
    return (
      sessionInput.access_token ||
      sessionInput.token ||
      sessionInput.accessToken ||
      sessionInput?.session?.access_token ||
      ""
    );
  }

  return "";
}

async function forwardJson(url, { method = "POST", headers = {}, bodyObj }) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: res.status, ok: res.ok, text, json };
}

/**
 * Convenience GETs (để bạn test trên browser cho đỡ hiểu nhầm)
 * - Browser GET vào /session/validate trước đây sẽ thấy "Not Found"
 * - Giờ sẽ thấy hướng dẫn rõ: phải POST
 */
router.get("/session/validate", (_req, res) => {
  res.status(200).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body { session: <token or json> }",
  });
});

router.get("/video/generate", (_req, res) => {
  res.status(200).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/video/generate",
  });
});

router.get("/video/status", (_req, res) => {
  res.status(200).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/video/status",
  });
});

/**
 * 1) Validate Session
 * POST /api/flow/session/validate
 * Body supported:
 *  - { session: "ya29..." }
 *  - { session: {"access_token":"ya29...","expires":"..."} }
 *  - { access_token: "ya29..." }  (lỡ app gửi thẳng)
 */
router.post("/session/validate", async (req, res) => {
  try {
    const sessionInput = req.body?.session ?? req.body ?? null;
    const accessToken = extractAccessToken(sessionInput);

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing Flow session token",
        hint: "Send { session: <token or json> }",
      });
    }

    console.log(`[FLOW_VALIDATE] -> ${FLOW_SESSION_VALIDATE_URL}`);

    const upstream = await forwardJson(FLOW_SESSION_VALIDATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      // Nhiều endpoint validate chỉ cần Bearer là đủ,
      // nhưng gửi thêm token trong body cũng không hại.
      bodyObj: { access_token: accessToken },
    });

    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: "Validate Session Failed",
        upstream: FLOW_SESSION_VALIDATE_URL,
        upstreamStatus: upstream.status,
        upstreamBody: upstream.text,
      });
    }

    // Return JSON nếu upstream trả JSON, không thì trả text
    return res.status(200).json({
      ok: true,
      upstreamStatus: upstream.status,
      data: upstream.json ?? upstream.text,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Proxy Error (validate)",
      details: String(err?.message || err),
    });
  }
});

/**
 * 2) Create Video Job
 * POST /api/flow/video/generate
 * Body recommended:
 *  {
 *    session: <token or json>,
 *    payload: { ... }   // payload gửi lên labs
 *  }
 * (Nếu app gửi thẳng body là payload thì cũng OK, miễn có session ở đâu đó)
 */
router.post("/video/generate", async (req, res) => {
  try {
    const sessionInput = req.body?.session ?? req.body?.auth ?? req.body?.flowSession ?? null;
    const accessToken = extractAccessToken(sessionInput);

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing Flow session token",
        hint: "Send { session: <token or json>, payload: {...} }",
      });
    }

    const payload = req.body?.payload ?? req.body?.data ?? req.body ?? {};

    console.log(`[FLOW_GENERATE] -> ${FLOW_VEO_GENERATE_URL}`);

    const upstream = await forwardJson(FLOW_VEO_GENERATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      bodyObj: payload,
    });

    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: "Create Job Failed",
        upstream: FLOW_VEO_GENERATE_URL,
        upstreamStatus: upstream.status,
        upstreamBody: upstream.text,
      });
    }

    return res.status(200).json({
      ok: true,
      upstreamStatus: upstream.status,
      data: upstream.json ?? upstream.text,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Proxy Error (generate)",
      details: String(err?.message || err),
    });
  }
});

/**
 * 3) Check Status
 * POST /api/flow/video/status
 * Body recommended:
 *  {
 *    session: <token or json>,
 *    jobId: "xxxx"  (hoặc payload tùy labs)
 *  }
 */
router.post("/video/status", async (req, res) => {
  try {
    const sessionInput = req.body?.session ?? req.body?.auth ?? req.body?.flowSession ?? null;
    const accessToken = extractAccessToken(sessionInput);

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing Flow session token",
        hint: "Send { session: <token or json>, jobId: '...' }",
      });
    }

    const payload = req.body?.payload ?? req.body ?? {};

    console.log(`[FLOW_STATUS] -> ${FLOW_VEO_STATUS_URL}`);

    const upstream = await forwardJson(FLOW_VEO_STATUS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      bodyObj: payload,
    });

    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: "Status Check Failed",
        upstream: FLOW_VEO_STATUS_URL,
        upstreamStatus: upstream.status,
        upstreamBody: upstream.text,
      });
    }

    return res.status(200).json({
      ok: true,
      upstreamStatus: upstream.status,
      data: upstream.json ?? upstream.text,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Proxy Error (status)",
      details: String(err?.message || err),
    });
  }
});

export default router;
