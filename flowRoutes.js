import express from "express";

const router = express.Router();

/**
 * Upstream URLs (có thể override bằng ENV trên Render)
 */
const FLOW_AUTH_URL =
  process.env.FLOW_AUTH_URL || "https://labs.google/fx/api/auth/session";

const FLOW_VEO_GENERATE_URL =
  process.env.FLOW_VEO_GENERATE_URL || "https://labs.google/fx/api/video/generate";

const FLOW_VEO_STATUS_URL =
  process.env.FLOW_VEO_STATUS_URL || "https://labs.google/fx/api/video/status";

/**
 * Helpers
 */
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function normalizeSessionInput(sessionInput) {
  // sessionInput có thể là:
  // - string "ya29...."
  // - string JSON '{"access_token":"ya29...","expires":"..."}'
  // - object {access_token,...}
  if (!sessionInput) return null;

  // If already object
  if (typeof sessionInput === "object") {
    const tok = sessionInput.access_token || sessionInput.token || sessionInput.accessToken;
    if (typeof tok === "string" && tok.trim()) return tok.trim();
    return null;
  }

  // If string
  if (typeof sessionInput === "string") {
    const s = sessionInput.trim();
    if (!s) return null;

    // If looks like JSON
    if ((s.startsWith("{") && s.endsWith("}")) || s.startsWith('{"')) {
      const obj = safeJsonParse(s);
      if (obj && typeof obj === "object") {
        const tok = obj.access_token || obj.token || obj.accessToken;
        if (typeof tok === "string" && tok.trim()) return tok.trim();
      }
      return null;
    }

    // Otherwise assume token
    return s;
  }

  return null;
}

async function fetchUpstream(url, token, bodyObj) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Accept: "application/json,text/plain,*/*",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : "{}",
  });

  const text = await res.text();
  // Try parse JSON, else keep text
  const json = safeJsonParse(text);

  return {
    status: res.status,
    ok: res.ok,
    text,
    json,
  };
}

/**
 * Debug: route index
 */
router.get("/", (_req, res) => {
  res.json({
    ok: true,
    routes: [
      "POST /api/flow/session/validate",
      "POST /api/flow/video/generate",
      "POST /api/flow/video/status",
    ],
  });
});

/**
 * 1) SESSION VALIDATE
 * - GET: báo route tồn tại (để bạn test bằng browser)
 * - POST: validate thật qua upstream
 */
router
  .route("/session/validate")
  .get((_req, res) => {
    res.status(200).json({
      ok: true,
      message: "Route exists. Use POST with { session } or { sessionKey }.",
    });
  })
  .post(async (req, res) => {
    try {
      const sessionInput = req.body?.session ?? req.body?.sessionKey ?? req.body?.flowSession ?? req.body;
      const token = normalizeSessionInput(sessionInput);

      if (!token) {
        return res.status(400).json({
          ok: false,
          error: "Missing/invalid Flow session token. Send JSON: { session: {access_token:'ya29...'} } or { sessionKey:'ya29...' }",
        });
      }

      console.log(`[FLOW_VALIDATE] -> ${FLOW_AUTH_URL}`);

      const upstream = await fetchUpstream(FLOW_AUTH_URL, token, {});
      if (!upstream.ok) {
        return res.status(502).json({
          ok: false,
          error: "Flow session validate failed",
          upstream: FLOW_AUTH_URL,
          upstreamStatus: upstream.status,
          upstreamBody: upstream.json ?? upstream.text,
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Valid Flow session",
        upstreamStatus: upstream.status,
        data: upstream.json ?? upstream.text,
      });
    } catch (err) {
      console.error("[FLOW_VALIDATE][ERROR]", err);
      return res.status(500).json({
        ok: false,
        error: "Internal server error in session/validate",
        details: String(err?.message || err),
      });
    }
  });

/**
 * 2) VIDEO GENERATE
 */
router
  .route("/video/generate")
  .get((_req, res) => {
    res.status(200).json({
      ok: true,
      message: "Route exists. Use POST with { session, payload }.",
    });
  })
  .post(async (req, res) => {
    try {
      const sessionInput = req.body?.session ?? req.body?.sessionKey ?? req.body?.flowSession;
      const token = normalizeSessionInput(sessionInput);
      const payload = req.body?.payload ?? req.body?.data ?? req.body?.request ?? {};

      if (!token) {
        return res.status(400).json({
          ok: false,
          error: "Missing/invalid Flow session token. Send { session: {...} }",
        });
      }

      console.log(`[FLOW_GENERATE] -> ${FLOW_VEO_GENERATE_URL}`);

      const upstream = await fetchUpstream(FLOW_VEO_GENERATE_URL, token, payload);

      if (!upstream.ok) {
        return res.status(502).json({
          ok: false,
          error: "Create Job Failed",
          upstream: FLOW_VEO_GENERATE_URL,
          upstreamStatus: upstream.status,
          upstreamBody: upstream.json ?? upstream.text,
        });
      }

      return res.status(200).json({
        ok: true,
        upstreamStatus: upstream.status,
        data: upstream.json ?? upstream.text,
      });
    } catch (err) {
      console.error("[FLOW_GENERATE][ERROR]", err);
      return res.status(500).json({
        ok: false,
        error: "Internal server error in video/generate",
        details: String(err?.message || err),
      });
    }
  });

/**
 * 3) VIDEO STATUS
 */
router
  .route("/video/status")
  .get((_req, res) => {
    res.status(200).json({
      ok: true,
      message: "Route exists. Use POST with { session, payload } or { session, jobId }.",
    });
  })
  .post(async (req, res) => {
    try {
      const sessionInput = req.body?.session ?? req.body?.sessionKey ?? req.body?.flowSession;
      const token = normalizeSessionInput(sessionInput);

      // payload có thể là { jobId } hoặc object đầy đủ
      const jobId = req.body?.jobId ?? req.body?.id;
      const payload = req.body?.payload ?? (jobId ? { jobId } : req.body?.data ?? {});

      if (!token) {
        return res.status(400).json({
          ok: false,
          error: "Missing/invalid Flow session token. Send { session: {...} }",
        });
      }

      console.log(`[FLOW_STATUS] -> ${FLOW_VEO_STATUS_URL}`);

      const upstream = await fetchUpstream(FLOW_VEO_STATUS_URL, token, payload);

      if (!upstream.ok) {
        return res.status(502).json({
          ok: false,
          error: "Check Status Failed",
          upstream: FLOW_VEO_STATUS_URL,
          upstreamStatus: upstream.status,
          upstreamBody: upstream.json ?? upstream.text,
        });
      }

      return res.status(200).json({
        ok: true,
        upstreamStatus: upstream.status,
        data: upstream.json ?? upstream.text,
      });
    } catch (err) {
      console.error("[FLOW_STATUS][ERROR]", err);
      return res.status(500).json({
        ok: false,
        error: "Internal server error in video/status",
        details: String(err?.message || err),
      });
    }
  });

export default router;
