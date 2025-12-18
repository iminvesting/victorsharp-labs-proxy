/**
 * flowRoutes.js - mounted at /api/flow
 *
 * Routes:
 *   POST /session/validate
 *   POST /video/generate
 *
 * Upstream:
 *   GET  https://labs.google/fx/api/auth/session
 *   POST https://labs.google/fx/api/video/generate
 */

const express = require("express");
const router = express.Router();

const UPSTREAM_AUTH_SESSION = "https://labs.google/fx/api/auth/session";
const UPSTREAM_VIDEO_GENERATE = "https://labs.google/fx/api/video/generate";

// -------------------------
// Helpers
// -------------------------
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Normalize user input -> cookie header
 * Accepts:
 *  - raw token: "ya29..." OR just token string
 *  - cookie string: "__Secure-next-auth.session-token=...; other=..."
 *  - JSON string/object: tries to find cookie/token fields
 */
function normalizeSessionToCookie(sessionInput) {
  if (!sessionInput) return "";

  // object
  if (typeof sessionInput === "object") {
    const obj = sessionInput;

    const cookie =
      obj.cookie ||
      obj.cookies ||
      obj.Cookie ||
      obj.sessionCookie ||
      obj.session_cookie ||
      obj.sessionTokenCookie;

    if (typeof cookie === "string" && cookie.includes("=")) return cookie;

    const token =
      obj.token ||
      obj.session ||
      obj.sessionToken ||
      obj.session_token ||
      obj.nextAuthSessionToken ||
      obj.next_auth_session_token;

    if (typeof token === "string" && token.trim()) {
      return `__Secure-next-auth.session-token=${token.trim()}`;
    }

    // fallback: find any string containing "="
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string" && v.includes("=")) return v;
    }
    return "";
  }

  // string
  const s = String(sessionInput).trim();
  if (!s) return "";

  // JSON string?
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    const parsed = safeJsonParse(s);
    if (parsed) return normalizeSessionToCookie(parsed);
  }

  // cookie string?
  if (s.includes("=")) return s;

  // raw token
  return `__Secure-next-auth.session-token=${s}`;
}

function buildUpstreamHeaders(cookieHeader) {
  const h = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://labs.google",
    referer: "https://labs.google/fx/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  };
  if (cookieHeader) h.cookie = cookieHeader;
  return h;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function readUpstream(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return { ok: false, error: "Upstream returned invalid JSON" };
    }
  }
  return await res.text();
}

// -------------------------
// Routes
// -------------------------

// GET for human testing -> hint
router.get("/session/validate", (req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/session/validate with JSON body: { session: <token|cookie|json> }",
  });
});

// POST validate
router.post("/session/validate", async (req, res) => {
  try {
    const sessionInput =
      (req.body && (req.body.session || req.body.token || req.body.flowKey)) ||
      req.headers["x-flow-session"] ||
      req.headers["x-flow-token"] ||
      req.headers["x-flow-cookie"];

    const cookieHeader = normalizeSessionToCookie(sessionInput);
    if (!cookieHeader) {
      return res.status(400).json({
        ok: false,
        error: "Missing session",
        hint: "Send JSON { session: <token or cookie> }",
      });
    }

    console.log(`[FLOW_VALIDATE] -> ${UPSTREAM_AUTH_SESSION}`);

    const upstreamRes = await fetchWithTimeout(
      UPSTREAM_AUTH_SESSION,
      { method: "GET", headers: buildUpstreamHeaders(cookieHeader) },
      30000
    );

    const upstreamBody = await readUpstream(upstreamRes);

    return res.status(upstreamRes.ok ? 200 : 401).json({
      ok: upstreamRes.ok,
      status: upstreamRes.status,
      upstream: UPSTREAM_AUTH_SESSION,
      upstreamBody,
    });
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Upstream timeout (AbortError)" : e?.message || "Validate failed";
    console.error("[FLOW_VALIDATE_ERROR]", e);
    return res.status(500).json({ ok: false, error: msg, upstream: UPSTREAM_AUTH_SESSION });
  }
});

// GET for human testing -> hint
router.get("/video/generate", (req, res) => {
  res.status(405).json({
    ok: false,
    error: "Method Not Allowed",
    hint: "Use POST /api/flow/video/generate with JSON body + { session }",
  });
});

// POST generate
router.post("/video/generate", async (req, res) => {
  try {
    const sessionInput =
      (req.body && (req.body.session || req.body.token || req.body.flowKey)) ||
      req.headers["x-flow-session"] ||
      req.headers["x-flow-token"] ||
      req.headers["x-flow-cookie"];

    const cookieHeader = normalizeSessionToCookie(sessionInput);
    if (!cookieHeader) {
      return res.status(400).json({
        ok: false,
        error: "Missing session",
        hint: "Send { session: <token or cookie> } along with your video payload",
      });
    }

    // remove session keys before forwarding
    const payload = { ...(req.body || {}) };
    delete payload.session;
    delete payload.token;
    delete payload.flowKey;

    console.log(`[FLOW_GENERATE] -> ${UPSTREAM_VIDEO_GENERATE}`);

    const upstreamRes = await fetchWithTimeout(
      UPSTREAM_VIDEO_GENERATE,
      {
        method: "POST",
        headers: buildUpstreamHeaders(cookieHeader),
        body: JSON.stringify(payload),
      },
      90000
    );

    const upstreamBody = await readUpstream(upstreamRes);

    return res.status(upstreamRes.status).json({
      ok: upstreamRes.ok,
      status: upstreamRes.status,
      upstream: UPSTREAM_VIDEO_GENERATE,
      upstreamBody,
    });
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Upstream timeout (AbortError)" : e?.message || "Generate failed";
    console.error("[FLOW_GENERATE_ERROR]", e);
    return res.status(500).json({ ok: false, error: msg, upstream: UPSTREAM_VIDEO_GENERATE });
  }
});

module.exports = router;
