// flowRoutes.js (ESM)

import express from "express";

const router = express.Router();

// Google Labs endpoints (as you logged)
const FLOW_BASE_URL = "https://labs.google";
const FLOW_SESSION_VALIDATE_URL = `${FLOW_BASE_URL}/fx/api/auth/session`;
const FLOW_VEO_GENERATE_URL = `${FLOW_BASE_URL}/fx/api/veo/generate`;
const FLOW_VEO_STATUS_URL = `${FLOW_BASE_URL}/fx/api/veo/status`;

// Helpers
function normalizeSessionInput(input) {
  // allow user paste raw token, or full JSON string
  if (!input) return null;
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return null;

    // If it's JSON text, parse it
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        return JSON.parse(t);
      } catch {
        // fall through: treat as token
      }
    }
    return t; // token
  }
  return input;
}

function buildLabsHeaders(sessionInput) {
  // You can adjust if Labs expects different auth style.
  // Current implementation: send cookie-like/session payload through JSON body
  // and also pass common headers.
  return {
    "Content-Type": "application/json",
    "User-Agent": "VictorSharp-Labs-Proxy/1.0",
  };
}

async function readUpstreamBody(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    return { kind: "json", data: await resp.json() };
  }
  return { kind: "text", data: await resp.text() };
}

/**
 * POST /api/flow/session/validate
 * body: { session: <token|string|json> }
 */
router.post("/session/validate", async (req, res) => {
  try {
    const sessionInput = normalizeSessionInput(req.body?.session);
    if (!sessionInput) {
      return res.status(400).json({
        ok: false,
        error: "Missing session. Send JSON body: { session: <token or json> }",
      });
    }

    const upstreamUrl = FLOW_SESSION_VALIDATE_URL;

    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      headers: buildLabsHeaders(sessionInput),
      body: JSON.stringify({ session: sessionInput }),
    });

    const body = await readUpstreamBody(upstreamResp);

    return res.status(upstreamResp.ok ? 200 : upstreamResp.status).json({
      ok: upstreamResp.ok,
      status: upstreamResp.status,
      upstream: upstreamUrl,
      data: body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Validate session failed (proxy fetch error)",
      upstream: FLOW_SESSION_VALIDATE_URL,
      detail: String(err?.message || err),
    });
  }
});

// GET will show hint (so browser open won't confuse you)
router.get("/session/validate", (_req, res) => {
  return res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body { session: <token or json> }",
  });
});

/**
 * POST /api/flow/veo/generate
 * body: pass-through (expects you include session in body if needed)
 */
router.post("/veo/generate", async (req, res) => {
  try {
    const upstreamUrl = FLOW_VEO_GENERATE_URL;

    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "VictorSharp-Labs-Proxy/1.0",
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const body = await readUpstreamBody(upstreamResp);

    return res.status(upstreamResp.ok ? 200 : upstreamResp.status).json({
      ok: upstreamResp.ok,
      status: upstreamResp.status,
      upstream: upstreamUrl,
      data: body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Veo generate failed (proxy fetch error)",
      upstream: FLOW_VEO_GENERATE_URL,
      detail: String(err?.message || err),
    });
  }
});

/**
 * GET /api/flow/veo/status/:id
 * GET /api/flow/video/status/:id (alias)
 */
async function handleStatus(req, res) {
  try {
    const id = req.params?.id;
    if (!id) {
      return res.status(400).json({ ok: false, error: "Missing id" });
    }

    const upstreamUrl = `${FLOW_VEO_STATUS_URL}/${encodeURIComponent(id)}`;

    const upstreamResp = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "User-Agent": "VictorSharp-Labs-Proxy/1.0",
      },
    });

    const body = await readUpstreamBody(upstreamResp);

    return res.status(upstreamResp.ok ? 200 : upstreamResp.status).json({
      ok: upstreamResp.ok,
      status: upstreamResp.status,
      upstream: upstreamUrl,
      data: body.data,
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: "Flow status failed (proxy fetch error)",
      upstream: FLOW_VEO_STATUS_URL,
      detail: String(err?.message || err),
    });
  }
}

router.get("/veo/status/:id", handleStatus);
router.get("/video/status/:id", handleStatus);

// Debug (optional)
router.get("/debug/env", (_req, res) => {
  res.json({
    ok: true,
    FLOW_BASE_URL,
    FLOW_SESSION_VALIDATE_URL,
    FLOW_VEO_GENERATE_URL,
    FLOW_VEO_STATUS_URL,
  });
});

export default router;
export { router };

